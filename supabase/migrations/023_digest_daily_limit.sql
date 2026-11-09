-- 023: send the digest a day's allowance at a time
--
-- Run once in the Supabase SQL Editor, after 001-022 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file.
--
-- Why: Resend's free plan allows 100 emails a day for the whole account, and
-- the same allowance carries sign-in codes, password resets, inbox alerts and
-- meeting confirmations. Before this file, a digest to 120 members would have
-- used the whole day, and nobody could sign in with a code until the next.
--
-- Now send_digest() queues every copy and sends at most digest_per_day of them
-- in any 24 hours (80 by default, leaving 20 for everything else). An hourly
-- job sends the rest as the allowance frees up, so a large digest arrives over
-- two or three days. On a paid Resend plan, lift the cap:
--
--   update public.email_settings set digest_per_day = 0;   -- 0 means no cap
--
-- Also note the free plan's 3,000 emails a month: four digests a month fit up
-- to about 700 members.

-- One row of settings. No grants: change it here, in the SQL Editor.
create table public.email_settings (
  id             boolean primary key default true check (id),
  digest_per_day integer not null default 80 check (digest_per_day >= 0)
);

comment on table public.email_settings is
  'Email sending limits. digest_per_day: digest copies sent in any 24 hours (0 = no cap).';

insert into public.email_settings default values;

alter table public.email_settings enable row level security;
revoke all on public.email_settings from anon, authenticated;

-- The digest itself, kept until every copy has gone
create table public.digest_outbox (
  issue_date date primary key references public.digest_sends (issue_date) on delete cascade,
  message    jsonb not null,
  created_at timestamptz not null default now()
);

-- One row per member a digest is for; sent_at is set when it is handed to Resend
create table public.digest_queue (
  issue_date date not null references public.digest_outbox (issue_date) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  sent_at    timestamptz,
  primary key (issue_date, user_id)
);

create index digest_queue_sent_at on public.digest_queue (sent_at);

alter table public.digest_outbox enable row level security;
alter table public.digest_queue enable row level security;
revoke all on public.digest_outbox from anon, authenticated;
revoke all on public.digest_queue from anon, authenticated;

-- recipients now counts copies sent so far; queued is how many were due
alter table public.digest_sends add column queued integer not null default 0;

-- Sends as many queued copies as today's allowance allows. Called by
-- send_digest() and by the hourly job; never by visitors or members.
create function public.digest_drip()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key   text;
  per_day   integer;
  allowance integer;
  batch     record;
  total     integer := 0;
begin
  -- Anyone who has left, been declined or switched the digest off since it
  -- was queued is not sent it
  delete from public.digest_queue q
   using public.profiles p
   where p.id = q.user_id
     and q.sent_at is null
     and (p.role not in ('member', 'moderator', 'admin') or not p.email_digest or p.email is null);

  select s.digest_per_day into per_day from public.email_settings s limit 1;
  per_day := coalesce(per_day, 80);
  if per_day = 0 then
    allowance := 1000000;
  else
    allowance := per_day - (select count(*) from public.digest_queue q
                             where q.sent_at > now() - interval '24 hours');
  end if;

  if allowance > 0 then
    select s.decrypted_secret into api_key
      from vault.decrypted_secrets s
     where s.name = 'resend_api_key'
     limit 1;
  end if;

  if allowance > 0 and api_key is not null then
    -- Oldest issue first, in groups of 50 (Resend's batch size)
    for batch in
      select t.issue_date,
             jsonb_agg(o.message || jsonb_build_object('to', jsonb_build_array(t.email))) as messages,
             array_agg(t.user_id) as ids,
             count(*)::integer as n
        from (
          select q.issue_date, q.user_id, p.email,
                 (row_number() over (order by q.issue_date, q.user_id) - 1) / 50 as grp
            from public.digest_queue q
            join public.profiles p on p.id = q.user_id
           where q.sent_at is null
           order by q.issue_date, q.user_id
           limit allowance
        ) t
        join public.digest_outbox o on o.issue_date = t.issue_date
       group by t.issue_date, t.grp
       order by t.issue_date, t.grp
    loop
      perform net.http_post(
        url := 'https://api.resend.com/emails/batch',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || api_key,
          'Content-Type', 'application/json'),
        body := batch.messages);
      update public.digest_queue
         set sent_at = now()
       where issue_date = batch.issue_date and user_id = any (batch.ids);
      update public.digest_sends
         set recipients = recipients + batch.n
       where issue_date = batch.issue_date;
      total := total + batch.n;
    end loop;
  end if;

  -- An issue whose every copy has gone no longer needs its stored copy. Wait
  -- a day, because the allowance above counts the copies sent in the last 24
  -- hours, and deleting the issue deletes its queue rows with it.
  delete from public.digest_outbox o
   where not exists (select 1 from public.digest_queue q
                      where q.issue_date = o.issue_date
                        and (q.sent_at is null or q.sent_at > now() - interval '24 hours'));

  return total;
end;
$$;

revoke execute on function public.digest_drip() from public, anon, authenticated;

-- Same arguments as 017, so the Moderation page calls it as before. Returns
-- how many members the digest is for; how many have been sent so far is in
-- digest_sends.recipients.
create or replace function public.send_digest(
  issue     date,
  subject   text,
  html      text,
  plain     text,
  test_only boolean default false,
  reply_to  text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key  text;
  me       uuid := (select auth.uid());
  my_email text;
  total    integer := 0;
  sender   text;
  answer   text := nullif(btrim(coalesce(reply_to, '')), '');
  message  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can send the digest';
  end if;

  if issue is null
     or char_length(coalesce(subject, '')) not between 5 and 200
     or char_length(coalesce(html, '')) not between 100 and 400000
     or char_length(coalesce(plain, '')) not between 20 and 200000 then
    raise exception 'The digest content is missing or too large';
  end if;

  select s.decrypted_secret into api_key
    from vault.decrypted_secrets s
   where s.name = 'resend_api_key'
   limit 1;

  if api_key is null then
    raise exception 'Email is not set up (no resend_api_key in Vault)';
  end if;

  if answer is not null and answer !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The reply address does not look like an email address';
  end if;

  select coalesce(
           nullif(regexp_replace(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '[^[:alpha:]''-]', '', 'g'), '')
             || ' at AI Medicine Collective',
           'AI Medicine Collective')
         || ' <digest@mail.aimedicinecollective.com>',
         p.email
    into sender, my_email
    from public.profiles p
   where p.id = me;

  message := jsonb_build_object('from', sender, 'subject', subject, 'html', html, 'text', plain);
  if answer is not null then
    message := message || jsonb_build_object('reply_to', answer);
  end if;

  -- A test goes at once, to the admin who asked
  if test_only then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'),
      body := message || jsonb_build_object(
        'to', jsonb_build_array(my_email),
        'subject', '[TEST] ' || subject));
    return 1;
  end if;

  begin
    insert into public.digest_sends (issue_date, sent_by) values (issue, me);
  exception when unique_violation then
    raise exception 'The digest for % was already sent', issue;
  end;

  insert into public.digest_outbox (issue_date, message) values (issue, message);

  insert into public.digest_queue (issue_date, user_id)
  select issue, p.id
    from public.profiles p
   where p.role in ('member', 'moderator', 'admin')
     and p.email_digest
     and p.email is not null;
  get diagnostics total = row_count;

  update public.digest_sends set queued = total where issue_date = issue;

  -- Send today's share now; the hourly job sends the rest
  perform public.digest_drip();
  return total;
end;
$$;

revoke execute on function public.send_digest(date, text, text, text, boolean, text) from public, anon;
grant execute on function public.send_digest(date, text, text, text, boolean, text) to authenticated;

-- Every hour, send whatever the allowance now permits (does nothing when the
-- queue is empty). Times are UTC.
select cron.schedule('amc-digest-drip', '17 * * * *',
  $job$select public.digest_drip()$job$);

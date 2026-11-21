-- 026: a longer "About me", and email alerts for new blog posts
--
-- Run once in the Supabase SQL Editor, after 001-024 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). It does not depend on 025, so it
-- can run before or after it. The site works before and after this file.
--
-- 1. About me: profiles.bio (migration 008) was capped at 1000 characters.
--    The account page now calls it "About me" and allows a few short
--    paragraphs, so the cap rises to 1500. Who can read it is unchanged
--    (the person, approved members, moderators).
--
-- 2. Blog alerts: members can ask for an email when a new blog post is
--    published (profiles.blog_alerts, off by default). A GitHub workflow calls
--    queue_blog_alert() once the post is live. That function:
--      - refuses the call unless it carries the shared secret stored in Vault
--        as blog_alert_secret (the same value is the GitHub Actions secret
--        BLOG_ALERT_SECRET);
--      - refuses a second call for the same post (blog_alert_sends);
--      - queues one copy for each approved member (member, moderator, admin)
--        who switched blog_alerts on. Pending and declined people are never
--        sent one, whatever their setting says.
--    Copies go out through the digest's daily allowance (migration 024): the
--    replaced digest_drip() below counts digest copies AND blog alerts against
--    email_settings.digest_per_day, so sign-in codes always keep their share
--    of Resend's 100 emails a day. Nothing here ever returns an email address.
--
-- 3. "You're in": when a moderator approves someone (pending -> member, or an
--    admin sets a pending person's role), they get one welcome email with
--    three first steps. Sent once per person (profiles.approved_email_at).
--
-- One-time setup after running this file (also in the pull request):
--   select vault.create_secret('<the random secret>', 'blog_alert_secret');
-- Without that secret every call is refused, so no alert can be sent.

-- ---------------------------------------------------------------------------
-- 1. About me: 1500 characters
-- ---------------------------------------------------------------------------

do $$
declare
  c record;
begin
  -- 008 created the check without naming it; find it by what it says
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.profiles'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ~ '\mbio\M'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 1500);

-- ---------------------------------------------------------------------------
-- 2. Blog alerts
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column blog_alerts boolean not null default false;

comment on column public.profiles.blog_alerts is
  'Email me new blog posts. Only approved members are ever sent one (queue_blog_alert).';

-- Each person reads and changes only their own row (policies from 001)
grant select (blog_alerts) on public.profiles to authenticated;
grant update (blog_alerts) on public.profiles to authenticated;

-- One row per post that has been announced; the message is kept until every
-- copy has gone. No grants: only the functions below use it.
create table public.blog_alert_sends (
  post_date  date primary key,
  message    jsonb,
  queued     integer not null default 0,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.blog_alert_sends is
  'Blog posts announced by email. queued: copies due; recipients: copies sent so far.';

-- One row per member a post's alert is for; sent_at is set when it is handed to Resend
create table public.blog_alert_queue (
  post_date date not null references public.blog_alert_sends (post_date) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  sent_at   timestamptz,
  primary key (post_date, user_id)
);

create index blog_alert_queue_sent_at on public.blog_alert_queue (sent_at);

alter table public.blog_alert_sends enable row level security;
alter table public.blog_alert_queue enable row level security;
revoke all on public.blog_alert_sends from anon, authenticated;
revoke all on public.blog_alert_queue from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The drip, replaced: digest copies and blog alerts share one allowance
-- ---------------------------------------------------------------------------

-- Same name and result as 024, so the hourly job (amc-digest-drip) and
-- send_digest() call it as before. Blog alerts go first (they are news);
-- digest copies use whatever is left.
create or replace function public.digest_drip()
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
  -- Anyone who has left, been declined or switched the email off since it
  -- was queued is not sent it
  delete from public.digest_queue q
   using public.profiles p
   where p.id = q.user_id
     and q.sent_at is null
     and (p.role not in ('member', 'moderator', 'admin') or not p.email_digest or p.email is null);
  delete from public.blog_alert_queue q
   using public.profiles p
   where p.id = q.user_id
     and q.sent_at is null
     and (p.role not in ('member', 'moderator', 'admin') or not p.blog_alerts or p.email is null);

  select s.digest_per_day into per_day from public.email_settings s limit 1;
  per_day := coalesce(per_day, 80);
  if per_day = 0 then
    allowance := 1000000;
  else
    allowance := per_day
      - (select count(*) from public.digest_queue q where q.sent_at > now() - interval '24 hours')
      - (select count(*) from public.blog_alert_queue q where q.sent_at > now() - interval '24 hours');
  end if;

  if allowance > 0 then
    select s.decrypted_secret into api_key
      from vault.decrypted_secrets s
     where s.name = 'resend_api_key'
     limit 1;
  end if;

  if allowance > 0 and api_key is not null then
    -- Blog alerts: oldest post first, in groups of 50 (Resend's batch size)
    for batch in
      select t.post_date,
             jsonb_agg(o.message || jsonb_build_object('to', jsonb_build_array(t.email))) as messages,
             array_agg(t.user_id) as ids,
             count(*)::integer as n
        from (
          select q.post_date, q.user_id, p.email,
                 (row_number() over (order by q.post_date, q.user_id) - 1) / 50 as grp
            from public.blog_alert_queue q
            join public.profiles p on p.id = q.user_id
           where q.sent_at is null
           order by q.post_date, q.user_id
           limit allowance
        ) t
        join public.blog_alert_sends o on o.post_date = t.post_date
       where o.message is not null
       group by t.post_date, t.grp
       order by t.post_date, t.grp
    loop
      perform net.http_post(
        url := 'https://api.resend.com/emails/batch',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || api_key,
          'Content-Type', 'application/json'),
        body := batch.messages);
      update public.blog_alert_queue
         set sent_at = now()
       where post_date = batch.post_date and user_id = any (batch.ids);
      update public.blog_alert_sends
         set recipients = recipients + batch.n
       where post_date = batch.post_date;
      total := total + batch.n;
      allowance := allowance - batch.n;
    end loop;
  end if;

  if allowance > 0 and api_key is not null then
    -- Digest copies: as in 024
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

  -- A digest whose every copy has gone no longer needs its stored copy (as in
  -- 024: wait a day, because the allowance counts the last 24 hours' copies)
  delete from public.digest_outbox o
   where not exists (select 1 from public.digest_queue q
                      where q.issue_date = o.issue_date
                        and (q.sent_at is null or q.sent_at > now() - interval '24 hours'));

  -- Same for blog alerts, except the blog_alert_sends row stays (it stops the
  -- same post being announced twice); only its stored message and the
  -- day-old queue rows go
  update public.blog_alert_sends o
     set message = null
   where o.message is not null
     and not exists (select 1 from public.blog_alert_queue q
                      where q.post_date = o.post_date and q.sent_at is null);
  delete from public.blog_alert_queue q
   where q.sent_at < now() - interval '2 days';

  return total;
end;
$$;

revoke execute on function public.digest_drip() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- queue_blog_alert: called by the blog-alert GitHub workflow
-- ---------------------------------------------------------------------------

-- The workflow calls this through Supabase's REST API with the publishable
-- key, so it runs as anon. The secret check inside is what protects it.
-- Returns how many members the alert is for; it never returns addresses.
create function public.queue_blog_alert(
  p_secret  text,
  p_date    date,
  p_subject text,
  p_html    text,
  p_text    text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected text;
  total    integer := 0;
begin
  select s.decrypted_secret into expected
    from vault.decrypted_secrets s
   where s.name = 'blog_alert_secret'
   limit 1;

  if expected is null or char_length(expected) < 20
     or p_secret is null or p_secret <> expected then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_date is null
     or p_date not between current_date - 14 and current_date + 1
     or char_length(coalesce(p_subject, '')) not between 5 and 200
     or char_length(coalesce(p_html, '')) not between 100 and 100000
     or char_length(coalesce(p_text, '')) not between 20 and 50000 then
    raise exception 'The alert is missing, too large, or not for a recent post';
  end if;

  begin
    insert into public.blog_alert_sends (post_date, message)
    values (p_date, jsonb_build_object(
      'from', 'AI Medicine Collective <blog@mail.aimedicinecollective.com>',
      'subject', p_subject,
      'html', p_html,
      'text', p_text));
  exception when unique_violation then
    raise exception 'The alert for the post of % was already sent', p_date
      using errcode = '23505';
  end;

  insert into public.blog_alert_queue (post_date, user_id)
  select p_date, p.id
    from public.profiles p
   where p.role in ('member', 'moderator', 'admin')
     and p.blog_alerts
     and p.email is not null;
  get diagnostics total = row_count;

  update public.blog_alert_sends set queued = total where post_date = p_date;

  -- Send today's share now; the hourly job sends the rest
  perform public.digest_drip();
  return total;
end;
$$;

revoke execute on function public.queue_blog_alert(text, date, text, text, text) from public, authenticated;
grant execute on function public.queue_blog_alert(text, date, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- 3. "You're in": one email when a membership is approved
-- ---------------------------------------------------------------------------
--
-- Until now nobody heard when a moderator approved them. A trigger on
-- profiles emails the person once, the first time their role goes from
-- pending to member, moderator or admin (approve_member, or an admin's
-- set_member_role). Same machinery as the inbox alert (011/015): Resend
-- through pg_net with the resend_api_key in Vault. No key means no email, and
-- a sending failure never blocks the approval. It is one email per approval,
-- sent at once rather than through the digest's daily allowance.

alter table public.profiles
  add column approved_email_at timestamptz;

comment on column public.profiles.approved_email_at is
  'When the "You''re in" email was sent (026). Never sent twice. No grants.';

create function public.send_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  first   text;
  site    constant text := 'https://www.aimedicinecollective.com';
  hello   text;
  body    text;
  html    text;
  note    constant text := 'The AI Medicine Collective is an independent, volunteer-run group. '
    || 'Everything on the site is for educational purposes only and is not medical advice.';
begin
  if new.email is null or new.approved_email_at is not null then
    return new;
  end if;

  select s.decrypted_secret into api_key
    from vault.decrypted_secrets s
   where s.name = 'resend_api_key'
   limit 1;
  if api_key is null then
    return new;
  end if;

  first := nullif(regexp_replace(split_part(btrim(coalesce(new.full_name, '')), ' ', 1), '[^[:alpha:]''-]', '', 'g'), '');
  hello := case when first is null then 'Hello,' else 'Hi ' || first || ',' end;

  body := hello || E'\n\n'
    || 'Good news: a moderator has approved your membership of the AI Medicine Collective. '
    || 'The members'' pages are open to you now.' || E'\n\n'
    || 'Three good first steps:' || E'\n\n'
    || '1. Complete your profile, including a few lines "About me", so other members know what you work on:' || E'\n'
    || '   ' || site || '/account.html#profile' || E'\n\n'
    || '2. Share your first creation or idea on Member Creations:' || E'\n'
    || '   ' || site || '/hub.html' || E'\n\n'
    || '3. Turn on email alerts for new blog posts:' || E'\n'
    || '   ' || site || '/account.html?alerts=blog' || E'\n\n'
    || 'Your account page: ' || site || '/account.html' || E'\n\n'
    || 'Welcome aboard,' || E'\n' || 'The AI Medicine Collective' || E'\n\n'
    || '--' || E'\n' || note || E'\n'
    || 'Please never post patient information anywhere on the site.';

  html := '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="light"></head>'
    || '<body style="margin:0;background:#efeae0;">'
    || '<div style="background:#efeae0;padding:28px 12px;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fbf8f2;border:1px solid #ddd5c6;">'
    || '<tr><td style="padding:34px 38px 30px;font-family:Georgia,''Times New Roman'',serif;color:#1d1d1b;">'
    || '<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:3px;color:#6b665c;">AI MEDICINE COLLECTIVE</p>'
    || '<p style="margin:0 0 18px;font-size:30px;line-height:1.15;">You''re in.</p>'
    || '<p style="margin:0 0 14px;font-size:17px;line-height:1.55;">' || replace(replace(replace(hello, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
    || '<p style="margin:0 0 18px;font-size:17px;line-height:1.55;">Good news: a moderator has approved your membership. The members&rsquo; pages are open to you now. Three good first steps:</p>'
    || '<ol style="margin:0 0 22px;padding-left:22px;font-size:17px;line-height:1.55;">'
    || '<li style="margin-bottom:10px;"><a href="' || site || '/account.html#profile" style="color:#1f5c3f;font-weight:bold;">Complete your profile</a>, including a few lines &ldquo;About me&rdquo;, so other members know what you work on.</li>'
    || '<li style="margin-bottom:10px;"><a href="' || site || '/hub.html" style="color:#1f5c3f;font-weight:bold;">Share your first creation or idea</a> on Member Creations.</li>'
    || '<li style="margin-bottom:10px;"><a href="' || site || '/account.html?alerts=blog" style="color:#1f5c3f;font-weight:bold;">Turn on email alerts</a> for new blog posts.</li>'
    || '</ol>'
    || '<p style="margin:0 0 26px;"><a href="' || site || '/account.html" style="display:inline-block;background:#1f5c3f;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;padding:12px 22px;border-radius:6px;">Open your account</a></p>'
    || '<p style="margin:0 0 4px;font-size:17px;line-height:1.55;">Welcome aboard,<br>The AI Medicine Collective</p>'
    || '<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #ddd5c6;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b665c;">'
    || note || ' Please never post patient information anywhere on the site.</p>'
    || '</td></tr></table></div></body></html>';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'AI Medicine Collective <noreply@mail.aimedicinecollective.com>',
      'to', jsonb_build_array(new.email),
      'subject', 'You''re in: welcome to the AI Medicine Collective',
      'html', html,
      'text', body));

  new.approved_email_at := now();
  return new;
exception when others then
  -- Email is a courtesy: a failure here must never stop the approval
  raise warning 'approval email not sent: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.send_welcome_email() from public, anon, authenticated;

-- BEFORE update, so the function can stamp approved_email_at on the same row
create trigger profiles_send_welcome_email
  before update of role on public.profiles
  for each row
  when (old.role = 'pending' and new.role in ('member', 'moderator', 'admin'))
  execute function public.send_welcome_email();

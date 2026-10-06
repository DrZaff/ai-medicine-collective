-- 013: send the weekly digest to members by email
--
-- Run once in the Supabase SQL Editor, after 001-012 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file. Needs the Resend key already stored in Vault as
-- 'resend_api_key' (see 011 and docs/auth-setup.md).
--
-- An admin presses "send" on the moderation page; the page hands the reviewed
-- digest (newsletter/<date>.html, already merged) to send_digest(), which
-- emails it to approved members who haven't opted out. Each week's digest can
-- be sent once. Nothing here runs on its own.

alter table public.profiles
  add column email_digest boolean not null default true;

comment on column public.profiles.email_digest is
  'Email this member the weekly digest. They can switch it off.';

grant select (email_digest) on public.profiles to authenticated;
grant update (email_digest) on public.profiles to authenticated;

-- One row per digest sent, so the same week can't go out twice.
create table public.digest_sends (
  issue_date date primary key,
  sent_by    uuid references public.profiles (id) on delete set null,
  sent_at    timestamptz not null default now(),
  recipients integer not null default 0
);

comment on table public.digest_sends is
  'Weekly digests that have been emailed to members, one row per week.';

alter table public.digest_sends enable row level security;

create policy "digest_sends: moderators read"
  on public.digest_sends
  for select
  to authenticated
  using (public.is_moderator());

revoke all on public.digest_sends from anon, authenticated;
grant select on public.digest_sends to authenticated;

-- Returns how many members it was sent to. With test_only, sends one copy to
-- the admin who asked and records nothing.
create function public.send_digest(
  issue     date,
  subject   text,
  html      text,
  plain     text,
  test_only boolean default false
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
  batch    record;
  total    integer := 0;
  sender   constant text := 'AI Medicine Collective <noreply@mail.aimedicinecollective.com>';
  headers  jsonb;
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

  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || api_key,
    'Content-Type', 'application/json');

  if test_only then
    select p.email into my_email from public.profiles p where p.id = me;
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := headers,
      body := jsonb_build_object(
        'from', sender,
        'to', jsonb_build_array(my_email),
        'subject', '[TEST] ' || subject,
        'html', html,
        'text', plain));
    return 1;
  end if;

  begin
    insert into public.digest_sends (issue_date, sent_by) values (issue, me);
  exception when unique_violation then
    raise exception 'The digest for % was already sent', issue;
  end;

  -- One email per member (nobody sees anyone else's address), handed to
  -- Resend in groups of 50.
  for batch in
    select jsonb_agg(jsonb_build_object(
             'from', sender,
             'to', jsonb_build_array(t.email),
             'subject', subject,
             'html', html,
             'text', plain)) as messages,
           count(*)::integer as n
      from (
        select p.email, (row_number() over (order by p.id) - 1) / 50 as grp
          from public.profiles p
         where p.role in ('member', 'moderator', 'admin')
           and p.email_digest
           and p.email is not null
      ) t
     group by t.grp
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails/batch',
      headers := headers,
      body := batch.messages);
    total := total + batch.n;
  end loop;

  update public.digest_sends set recipients = total where issue_date = issue;
  return total;
end;
$$;

revoke execute on function public.send_digest(date, text, text, text, boolean) from public, anon;
grant execute on function public.send_digest(date, text, text, text, boolean) to authenticated;

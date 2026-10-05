-- 011: email a member when they get a private message
--
-- Run once in the Supabase SQL Editor, after 001-010 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file.
--
-- When a private message is saved, the recipient gets a short email saying a
-- message is waiting, with a link to their inbox. The email never contains
-- the message itself. At most one alert per person every 30 minutes, and each
-- member can switch alerts off on their account page.
--
-- Sending needs the Resend key, which is stored separately in Supabase Vault
-- under the name 'resend_api_key' (see docs/auth-setup.md; never in this
-- repo). Until that secret exists, nothing is sent and messages still work.

-- Lets the database make web requests (to Resend). Requests are queued and
-- sent in the background, so saving a message never waits on email.
create extension if not exists pg_net;

alter table public.profiles
  add column email_alerts boolean not null default true,
  add column last_inbox_alert_at timestamptz;

comment on column public.profiles.email_alerts is
  'Email this member when they receive a private message. They can switch it off.';

-- Members read and change their own setting (the "update own row" rule from
-- 001 limits changes to their own row). last_inbox_alert_at is internal.
grant select (email_alerts) on public.profiles to authenticated;
grant update (email_alerts) on public.profiles to authenticated;

create function public.email_inbox_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key   text;
  recipient record;
  sender    text;
  about     text;
begin
  select s.decrypted_secret into api_key
    from vault.decrypted_secrets s
   where s.name = 'resend_api_key'
   limit 1;

  if api_key is null then
    return new;  -- email isn't set up
  end if;

  select p.email, p.email_alerts, p.last_inbox_alert_at, p.role
    into recipient
    from public.profiles p
   where p.id = new.recipient_id;

  if recipient.email is null
     or not recipient.email_alerts
     or recipient.role not in ('member', 'moderator', 'admin')
     or recipient.last_inbox_alert_at > now() - interval '30 minutes' then
    return new;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'A member') into sender
    from public.profiles p where p.id = new.sender_id;
  select pr.title into about from public.projects pr where pr.id = new.project_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'AI Medicine Collective <noreply@mail.aimedicinecollective.com>',
      'to', jsonb_build_array(recipient.email),
      'subject', 'New message in your AI Medicine Collective inbox',
      'text',
        coalesce(sender, 'A member') || ' sent you a private message'
        || coalesce(' about "' || about || '"', '') || '.' || E'\n\n'
        || 'Read and reply in your inbox:' || E'\n'
        || 'https://ai-medicine-collective.netlify.app/inbox.html' || E'\n\n'
        || 'For privacy, the message itself is not included in this email.' || E'\n'
        || 'To stop these alerts, open your account page, then "Your profile", and untick the email option.'
    )
  );

  update public.profiles
     set last_inbox_alert_at = now()
   where id = new.recipient_id;

  return new;
exception when others then
  -- Email is a courtesy: a failure here must never stop the message itself
  raise warning 'inbox alert not sent: %', sqlerrm;
  return new;
end;
$$;

revoke execute on function public.email_inbox_alert() from public, anon, authenticated;

create trigger project_messages_email_alert
  after insert on public.project_messages
  for each row execute function public.email_inbox_alert();

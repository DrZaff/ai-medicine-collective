-- 015: inbox alert emails link to the site's own address
--
-- Run once in the Supabase SQL Editor, after 001-014 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, alert emails keep linking to the old
-- netlify address, which still works.
--
-- The site now lives at https://www.aimedicinecollective.com. This replaces
-- the function from 011 with the same logic and the new link. The trigger
-- and permissions from 011 are unchanged.

create or replace function public.email_inbox_alert()
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
        || 'https://www.aimedicinecollective.com/inbox.html' || E'\n\n'
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

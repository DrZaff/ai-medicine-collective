-- 017: the digest is sent from a person, and replies reach them
--
-- Run once in the Supabase SQL Editor, after 001-016 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, the digest still sends from the no-reply
-- address.
--
-- Replaces send_digest() from 013 with the same logic plus:
--   * the sender shows as "<your first name> at AI Medicine Collective"
--   * an optional reply address, so members can answer the digest
-- The old five-argument version is removed first: two versions side by side
-- would make calls ambiguous.

drop function public.send_digest(date, text, text, text, boolean);

create function public.send_digest(
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
  batch    record;
  total    integer := 0;
  sender   text;
  answer   text := nullif(btrim(coalesce(reply_to, '')), '');
  headers  jsonb;
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

  -- "Brandon at AI Medicine Collective": a letter from a person, not a system
  select coalesce(
           nullif(regexp_replace(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '[^[:alpha:]''-]', '', 'g'), '')
             || ' at AI Medicine Collective',
           'AI Medicine Collective')
         || ' <digest@mail.aimedicinecollective.com>',
         p.email
    into sender, my_email
    from public.profiles p
   where p.id = me;

  -- Everything the same for every copy; only the recipient changes
  message := jsonb_build_object('from', sender, 'subject', subject, 'html', html, 'text', plain);
  if answer is not null then
    message := message || jsonb_build_object('reply_to', answer);
  end if;

  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || api_key,
    'Content-Type', 'application/json');

  if test_only then
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := headers,
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

  -- One email per member (nobody sees anyone else's address), handed to
  -- Resend in groups of 50.
  for batch in
    select jsonb_agg(message || jsonb_build_object('to', jsonb_build_array(t.email))) as messages,
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

revoke execute on function public.send_digest(date, text, text, text, boolean, text) from public, anon;
grant execute on function public.send_digest(date, text, text, text, boolean, text) to authenticated;

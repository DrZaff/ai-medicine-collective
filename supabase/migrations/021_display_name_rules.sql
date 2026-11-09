-- 021_display_name_rules.sql
-- Display names and profile photos (national-readiness audit, 2026-11-08).
--
-- Why: any signed-in person, pending included, could set any display name
-- (001 grants update(full_name) with no check), and that name is quoted in
-- emails sent from the Collective's own domain ("<name> sent you a private
-- message", 011/015) and in chat. A name such as "Admin team - verify your
-- account at evil.example" turned official emails into phishing. The photo
-- address was copied from sign-up data unchecked, so it could point at any
-- server and log the address of every member who viewed it.
--
-- What this does:
--   * public.clean_display_name(text): trims, folds runs of spaces, removes
--     control characters and cuts to 80 characters.
--   * A trigger on profiles that cleans every new or changed name and refuses
--     names that contain a web address or claim a role on the site
--     (admin, moderator, support, "AI Medicine Collective", "verify ...").
--     On sign-up (insert) a refused name is dropped, so the account is still
--     created and the person is asked for a name; on a change (update) the
--     database refuses it with a message the account page shows.
--   * Profile photos are kept only from Google's photo servers
--     (*.googleusercontent.com), the one place sign-in photos come from.
--   * Existing rows are not changed. The query at the end lists any that
--     would now be refused, for a moderator to review.
--
-- Run once in the Supabase SQL Editor.

create or replace function public.clean_display_name(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    left(
      btrim(regexp_replace(regexp_replace(coalesce(raw, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')),
      80),
    '')
$$;

-- Why a name is refused, or null when it is fine
create or replace function public.display_name_problem(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when name is null then null
    when name ~* '(https?:|www\.|://|[a-z0-9-]+\.(com|org|net|io|co|edu|gov|info|biz|app|dev|ly|me|us|uk|ai|xyz|link|site|online)(\M|/))'
      then 'Display names cannot contain a web address.'
    when name ~* '(\m(admin|administrator|moderator|mod team|support|helpdesk|help desk|staff team|official)\M|ai medicine collective|\mverif(y|ication)\M|\mpassword\M|\maccount (suspended|locked)\M)'
      then 'Display names cannot claim a role on the site (admin, moderator, support) or ask people to verify anything.'
    else null
  end
$$;

create or replace function public.profiles_check_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  problem text;
begin
  new.full_name := public.clean_display_name(new.full_name);
  problem := public.display_name_problem(new.full_name);
  if problem is not null then
    if tg_op = 'INSERT' then
      new.full_name := null;  -- sign-up still works; the account page asks for a name
    else
      raise exception '%', problem using errcode = 'check_violation';
    end if;
  end if;

  -- Photos only from Google's photo servers
  if new.avatar_url is not null
     and new.avatar_url !~* '^https://[a-z0-9-]+\.googleusercontent\.com/' then
    new.avatar_url := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_check_display_name on public.profiles;
create trigger profiles_check_display_name
  before insert or update of full_name, avatar_url on public.profiles
  for each row execute function public.profiles_check_display_name();

-- ---------------------------------------------------------------- review
-- Names already saved that would now be refused (read-only):
--   select id, full_name, role, public.display_name_problem(public.clean_display_name(full_name)) as problem
--     from public.profiles
--    where public.display_name_problem(public.clean_display_name(full_name)) is not null;
-- Photos that are not from Google:
--   select id, full_name, avatar_url from public.profiles
--    where avatar_url is not null and avatar_url !~* '^https://[a-z0-9-]+\.googleusercontent\.com/';

-- 012: institution on profiles, and an opt-in public member list
--
-- Run once in the Supabase SQL Editor, after 001-011 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, the Members page shows only the admin team.
--
-- Members can add their institution, and can choose to appear on the public
-- Members page. Nobody is listed publicly unless they tick the box: profiles
-- stay members-only otherwise (008).

alter table public.profiles
  add column institution    text check (char_length(institution) <= 120),
  add column public_listing boolean not null default false;

comment on column public.profiles.public_listing is
  'The member chose to appear on the public Members page (name, picture, institution, program, level).';

-- Members read these on each other's profiles and change their own.
grant select (institution, public_listing) on public.profiles to authenticated;
grant update (institution, public_listing) on public.profiles to authenticated;

-- What signed-out visitors may see: only approved members who opted in, and
-- only these columns. A function rather than a table grant, so visitors
-- never get to read profile columns of anyone who didn't opt in.
create function public.public_members()
returns table (
  id             uuid,
  full_name      text,
  avatar_url     text,
  institution    text,
  program        text,
  training_level text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_url, p.institution, p.program, p.training_level
    from public.profiles p
   where p.public_listing
     and p.role in ('member', 'moderator', 'admin')
     and nullif(btrim(p.full_name), '') is not null
   order by p.full_name;
$$;

revoke execute on function public.public_members() from public;
grant execute on function public.public_members() to anon, authenticated;

-- 001: member profiles and roles
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). Safe to read top to bottom: it only creates
-- things, and it fails rather than overwriting if they already exist.
--
-- The project was created with "Automatically expose new tables" OFF and
-- "Enable automatic RLS" ON, so this file grants access explicitly and
-- nothing is readable by signed-out visitors.
--
-- Roles:
--   pending    signed in with Google, waiting for a moderator
--   rejected   request declined (can sign in, sees nothing)
--   member     approved; can use members-only features
--   moderator  can approve/reject pending members and moderate content
--   admin      moderator + can change anyone's role

-- ---------------------------------------------------------------- types

create type public.member_role as enum (
  'pending', 'rejected', 'member', 'moderator', 'admin'
);

-- ---------------------------------------------------------------- table

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        public.member_role not null default 'pending',
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null
);

comment on table public.profiles is
  'One row per signed-in person. Created automatically on first sign-in; role starts as pending.';

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------- role helpers
-- SECURITY DEFINER so they can read the caller's own role without tripping
-- the row-level-security rules that call them. search_path is emptied so
-- every name inside is fully qualified.

create function public.my_role()
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() in ('member', 'moderator', 'admin'), false);
$$;

create function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() in ('moderator', 'admin'), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- ---------------------------------------------------------------- new sign-ins
-- When someone signs in for the first time, create their pending profile
-- from what Google shared (name, email, picture).

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- who can read what

-- You can always read your own row (so the site can show "pending approval").
-- Approved members can read other approved members.
-- Moderators and admins can read everyone, including pending requests.
create policy "profiles: read own, members read members, moderators read all"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (public.is_member() and role in ('member', 'moderator', 'admin'))
    or public.is_moderator()
  );

-- You can edit your own row, but only the display name (see column grant below).
create policy "profiles: update own row"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert or delete policies: rows are created by the sign-in trigger and
-- removed only when the account itself is deleted.

-- ---------------------------------------------------------------- role changes
-- Roles are never edited directly. These functions are the only way, and
-- each checks who is calling.

create function public.approve_member(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can approve members';
  end if;

  update public.profiles
     set role = 'member', approved_at = now(), approved_by = (select auth.uid())
   where id = target and role in ('pending', 'rejected');

  if not found then
    raise exception 'No pending request found for that person';
  end if;
end;
$$;

create function public.reject_member(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can reject requests';
  end if;

  update public.profiles
     set role = 'rejected', approved_at = null, approved_by = null
   where id = target and role = 'pending';

  if not found then
    raise exception 'No pending request found for that person';
  end if;
end;
$$;

create function public.set_member_role(target uuid, new_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;

  if target = (select auth.uid()) then
    raise exception 'Admins cannot change their own role';
  end if;

  update public.profiles
     set role = new_role,
         approved_at = case when new_role in ('member', 'moderator', 'admin')
                            then coalesce(approved_at, now()) else null end,
         approved_by = case when new_role in ('member', 'moderator', 'admin')
                            then coalesce(approved_by, (select auth.uid())) else null end
   where id = target;

  if not found then
    raise exception 'No such person';
  end if;
end;
$$;

-- ---------------------------------------------------------------- grants
-- Signed-out visitors (anon) get nothing. Signed-in people get exactly this.

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

revoke execute on function
  public.my_role(), public.is_member(), public.is_moderator(), public.is_admin(),
  public.approve_member(uuid), public.reject_member(uuid),
  public.set_member_role(uuid, public.member_role)
from public, anon;
-- (handle_new_user is left alone: trigger functions can't be called through
-- the API, and the sign-in service must be able to fire it.)

grant execute on function
  public.my_role(), public.is_member(), public.is_moderator(), public.is_admin(),
  public.approve_member(uuid), public.reject_member(uuid),
  public.set_member_role(uuid, public.member_role)
to authenticated;

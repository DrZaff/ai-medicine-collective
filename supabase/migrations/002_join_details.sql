-- 002: "about you" details for membership requests
--
-- Run once in the Supabase SQL Editor, after 001 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run).
--
-- Stores what the old emailed join form asked for (role, program, interests,
-- message) with the person's account, so moderators see it next to each
-- pending request. Kept in its own table, not on profiles, because approved
-- members can read each other's profiles but should not read each other's
-- request messages.
--
-- Who can read a row: the person it belongs to, and moderators/admins.
-- Who can write a row: only the person it belongs to.

-- ---------------------------------------------------------------- table

create table public.join_details (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  training_role text not null check (training_role in (
                  'Medical student', 'Resident / Fellow', 'Attending / Faculty',
                  'Other healthcare professional', 'Other')),
  program       text check (char_length(program) <= 120),
  interests     text[] not null default '{}' check (interests <@ array[
                  'Medical education', 'Patient care', 'Research',
                  'Guidelines', 'Lifestyle', 'Learning AI skills']),
  message       text check (char_length(message) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.join_details is
  'Optional details a person gives with their membership request. Readable by that person and by moderators only.';

alter table public.join_details enable row level security;

-- ---------------------------------------------------------------- updated_at

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger join_details_touch_updated_at
  before update on public.join_details
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- policies

create policy "join_details: read own, moderators read all"
  on public.join_details
  for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_moderator());

create policy "join_details: insert own"
  on public.join_details
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "join_details: update own"
  on public.join_details
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No delete policy: details go away only when the account is deleted.

-- ---------------------------------------------------------------- grants
-- Signed-out visitors get nothing. Signed-in people may read (subject to the
-- policies above) and write only the content columns, never the timestamps.

revoke all on public.join_details from anon, authenticated;
grant select on public.join_details to authenticated;
grant insert (user_id, training_role, program, interests, message)
  on public.join_details to authenticated;
grant update (training_role, program, interests, message)
  on public.join_details to authenticated;

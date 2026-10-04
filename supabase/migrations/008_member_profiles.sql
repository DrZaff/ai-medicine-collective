-- 008: member profiles
--
-- Run once in the Supabase SQL Editor, after 001-007 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, the profile form and the directory simply
-- show a "not available yet" message.
--
-- Adds the fields a member can write about themselves. Who can read them is
-- unchanged from 001: the person, approved members (for other approved
-- members), and moderators. Signed-out visitors can read none of these
-- columns; they still see only the name and picture of project authors.

alter table public.profiles
  add column program        text check (char_length(program) <= 120),
  add column training_level text check (char_length(training_level) <= 40),
  add column focus_areas    text check (char_length(focus_areas) <= 300),
  add column bio            text check (char_length(bio) <= 1000),
  -- An address the member chooses to show other members. Separate from the
  -- sign-in email, which stays private (006).
  add column contact_email  text check (
    char_length(contact_email) <= 120
    and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column link_url       text check (link_url ~ '^https://' and char_length(link_url) <= 300);

-- 006 limited what signed-in people can read to named columns, so the new
-- ones have to be granted explicitly. Each person can edit only their own row
-- (policy "profiles: update own row" from 001), and only these columns.
grant select (program, training_level, focus_areas, bio, contact_email, link_url)
  on public.profiles to authenticated;
grant update (program, training_level, focus_areas, bio, contact_email, link_url)
  on public.profiles to authenticated;

-- 007 let anyone, signed in or not, see the rows of people who authored a
-- published project (for the author's name). Signed-in people can now read
-- the profile columns above, so that rule must cover signed-out visitors
-- only (they can read just id, name and picture). Otherwise someone who has
-- signed in but isn't approved yet could read those authors' profiles.
-- Side effect: until approved, a signed-in person sees "Member" instead of
-- the author's name on public projects.
drop policy "profiles: anyone can see who authored a published project" on public.profiles;

create policy "profiles: visitors can see who authored a published project"
  on public.profiles
  for select
  to anon
  using (
    exists (
      select 1 from public.projects p
       where p.author_id = profiles.id
         and p.status = 'published'
         and p.kind = 'project')
  );

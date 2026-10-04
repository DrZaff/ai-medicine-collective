-- 009: tool requests (with votes) and the core learning path (with progress)
--
-- Run once in the Supabase SQL Editor, after 001-008 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, the Requests page and the core path simply
-- say they aren't available yet.
--
-- Everything here is members-only, like chat: approved members read and
-- write, signed-out visitors and people still waiting for approval get
-- nothing. Requests are not reviewed before they appear (also like chat);
-- moderators can delete any of them.

-- ---------------------------------------------------------------- tool requests

create type public.request_status as enum ('open', 'claimed', 'done');

create table public.tool_requests (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null
             constraint tool_requests_author_id_fkey references public.profiles (id) on delete cascade,
  title      text not null check (char_length(title) between 5 and 120),
  details    text check (char_length(details) <= 1000),
  status     public.request_status not null default 'open',
  -- Who said "I'll build this"
  claimed_by uuid
             constraint tool_requests_claimed_by_fkey references public.profiles (id) on delete set null,
  -- The finished project, once there is one
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.tool_requests is
  '"I wish there were a tool for X": posted, upvoted and claimed by approved members.';

create index tool_requests_status_idx on public.tool_requests (status, created_at desc);

alter table public.tool_requests enable row level security;

create policy "tool_requests: members read"
  on public.tool_requests
  for select
  to authenticated
  using (public.is_member());

create policy "tool_requests: members post as themselves"
  on public.tool_requests
  for insert
  to authenticated
  with check (public.is_member() and author_id = (select auth.uid()));

-- Authors can withdraw a request nobody has picked up; moderators can remove any.
create policy "tool_requests: author removes own open request, moderators remove any"
  on public.tool_requests
  for delete
  to authenticated
  using (
    public.is_moderator()
    or (public.is_member() and author_id = (select auth.uid()) and status = 'open')
  );

-- No update policy: status, claimed_by and project_id change only through
-- the functions below.

revoke all on public.tool_requests from anon, authenticated;
grant select, delete on public.tool_requests to authenticated;
grant insert (author_id, title, details) on public.tool_requests to authenticated;

-- "I'll build this"
create function public.claim_tool_request(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'Only members can claim a request';
  end if;

  update public.tool_requests
     set status = 'claimed',
         claimed_by = (select auth.uid())
   where id = target and status = 'open';

  if not found then
    raise exception 'That request is not open';
  end if;
end;
$$;

-- Hand it back (the person who claimed it, or a moderator)
create function public.release_tool_request(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tool_requests
     set status = 'open',
         claimed_by = null
   where id = target
     and status = 'claimed'
     and (claimed_by = (select auth.uid()) or public.is_moderator());

  if not found then
    raise exception 'Only the person building it, or a moderator, can release a request';
  end if;
end;
$$;

-- Mark it built, optionally pointing at the published project
create function public.complete_tool_request(target uuid, built uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if built is not null and not exists (
    select 1 from public.projects p where p.id = built and p.status = 'published'
  ) then
    raise exception 'That project is not published';
  end if;

  update public.tool_requests
     set status = 'done',
         project_id = built
   where id = target
     and status = 'claimed'
     and (claimed_by = (select auth.uid()) or public.is_moderator());

  if not found then
    raise exception 'Only the person building it, or a moderator, can mark a request built';
  end if;
end;
$$;

revoke execute on function public.claim_tool_request(uuid) from public, anon;
revoke execute on function public.release_tool_request(uuid) from public, anon;
revoke execute on function public.complete_tool_request(uuid, uuid) from public, anon;
grant execute on function public.claim_tool_request(uuid) to authenticated;
grant execute on function public.release_tool_request(uuid) to authenticated;
grant execute on function public.complete_tool_request(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- votes
-- One row per member per request; the primary key stops double votes.

create table public.tool_request_votes (
  request_id uuid not null references public.tool_requests (id) on delete cascade,
  user_id    uuid not null
             constraint tool_request_votes_user_id_fkey references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

comment on table public.tool_request_votes is
  'Upvotes on tool requests, one per member per request.';

alter table public.tool_request_votes enable row level security;

create policy "tool_request_votes: members read"
  on public.tool_request_votes
  for select
  to authenticated
  using (public.is_member());

create policy "tool_request_votes: members vote as themselves"
  on public.tool_request_votes
  for insert
  to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));

create policy "tool_request_votes: members take back their own vote"
  on public.tool_request_votes
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.tool_request_votes from anon, authenticated;
grant select, delete on public.tool_request_votes to authenticated;
grant insert (request_id, user_id) on public.tool_request_votes to authenticated;

-- ---------------------------------------------------------------- core learning path
-- A short, ordered list of published learning materials chosen by
-- moderators. Members keep contributing to the open library (004); the best
-- of those get picked for the path.

create table public.learning_path_items (
  project_id uuid primary key references public.projects (id) on delete cascade,
  position   integer not null default 100,  -- lower numbers come first
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.learning_path_items is
  'The core learning path: published materials picked and ordered by moderators.';

alter table public.learning_path_items enable row level security;

create policy "learning_path_items: members read"
  on public.learning_path_items
  for select
  to authenticated
  using (public.is_member());

create policy "learning_path_items: moderators add published materials"
  on public.learning_path_items
  for insert
  to authenticated
  with check (
    public.is_moderator()
    and exists (
      select 1 from public.projects p
       where p.id = project_id and p.kind = 'material' and p.status = 'published')
  );

create policy "learning_path_items: moderators reorder"
  on public.learning_path_items
  for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

create policy "learning_path_items: moderators remove"
  on public.learning_path_items
  for delete
  to authenticated
  using (public.is_moderator());

revoke all on public.learning_path_items from anon, authenticated;
grant select, delete on public.learning_path_items to authenticated;
grant insert (project_id, position, added_by) on public.learning_path_items to authenticated;
grant update (position) on public.learning_path_items to authenticated;

-- ---------------------------------------------------------------- learning progress
-- "I finished this one." Members can see each other's progress, so a
-- profile can show that someone completed the core path.

create table public.learning_progress (
  user_id      uuid not null
               constraint learning_progress_user_id_fkey references public.profiles (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

comment on table public.learning_progress is
  'Learning materials a member has marked as done.';

alter table public.learning_progress enable row level security;

create policy "learning_progress: members read"
  on public.learning_progress
  for select
  to authenticated
  using (public.is_member());

create policy "learning_progress: members mark their own"
  on public.learning_progress
  for insert
  to authenticated
  with check (public.is_member() and user_id = (select auth.uid()));

create policy "learning_progress: members unmark their own"
  on public.learning_progress
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.learning_progress from anon, authenticated;
grant select, delete on public.learning_progress to authenticated;
grant insert (user_id, project_id) on public.learning_progress to authenticated;

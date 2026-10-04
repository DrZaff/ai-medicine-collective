-- 003: Projects hub (projects, comments, uploaded files)
--
-- Run once in the Supabase SQL Editor, after 001 and 002 (Dashboard > SQL
-- Editor > New query > paste this whole file > Run).
--
-- How a project moves:
--   a member submits it        -> status 'pending'  (author + moderators see it)
--   a moderator approves it    -> status 'published' (all approved members see it)
--   a moderator rejects it     -> status 'rejected'  (author + moderators, with a note)
--   only moderators can delete a project
--
-- Signed-out visitors can read nothing here.

-- ---------------------------------------------------------------- projects

create type public.project_status as enum ('pending', 'published', 'rejected');

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null
              constraint projects_author_id_fkey references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 3 and 120),
  category    text not null check (category in (
                'Medical education', 'Patient care', 'Research', 'Guidelines',
                'Learning', 'Lifestyle', 'Productivity', 'Other')),
  description text not null check (char_length(description) between 20 and 4000),
  link_url    text check (link_url ~ '^https://' and char_length(link_url) <= 500),
  file_path   text check (char_length(file_path) <= 300),
  file_name   text check (char_length(file_name) <= 150),
  status      public.project_status not null default 'pending',
  review_note text check (char_length(review_note) <= 500),
  reviewed_by uuid
              constraint projects_reviewed_by_fkey references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.projects is
  'Member-submitted AI projects. Published ones are visible to approved members; pending/rejected only to the author and moderators.';

create index projects_status_created_idx on public.projects (status, created_at desc);
create index projects_author_idx on public.projects (author_id);

alter table public.projects enable row level security;

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

create policy "projects: members read published, authors read own, moderators read all"
  on public.projects
  for select
  to authenticated
  using (
    public.is_moderator()
    or (public.is_member() and (status = 'published' or author_id = (select auth.uid())))
  );

create policy "projects: members submit their own"
  on public.projects
  for insert
  to authenticated
  with check (
    public.is_member()
    and author_id = (select auth.uid())
    -- an attached file must be one the author uploaded (their own folder)
    and (file_path is null or file_path like (select auth.uid())::text || '/%')
  );

-- Authors can fix a submission that isn't published yet. Published projects
-- are changed through a moderator.
create policy "projects: authors edit own unpublished"
  on public.projects
  for update
  to authenticated
  using (author_id = (select auth.uid()) and status in ('pending', 'rejected'))
  with check (
    author_id = (select auth.uid())
    and (file_path is null or file_path like (select auth.uid())::text || '/%')
  );

create policy "projects: only moderators delete"
  on public.projects
  for delete
  to authenticated
  using (public.is_moderator());

-- Status is never set directly (no column grant below); moderators use this.
create function public.review_project(
  target uuid,
  new_status public.project_status,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can review projects';
  end if;

  update public.projects
     set status = new_status,
         review_note = nullif(btrim(coalesce(note, '')), ''),
         reviewed_by = (select auth.uid()),
         reviewed_at = now()
   where id = target;

  if not found then
    raise exception 'No such project';
  end if;
end;
$$;

revoke all on public.projects from anon, authenticated;
grant select, delete on public.projects to authenticated;
grant insert (author_id, title, category, description, link_url, file_path, file_name)
  on public.projects to authenticated;
grant update (title, category, description, link_url, file_path, file_name)
  on public.projects to authenticated;

revoke execute on function public.review_project(uuid, public.project_status, text) from public, anon;
grant execute on function public.review_project(uuid, public.project_status, text) to authenticated;

-- ---------------------------------------------------------------- comments

create table public.project_comments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id  uuid not null
             constraint project_comments_author_id_fkey references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.project_comments is
  'Questions and comments on published projects, from approved members.';

create index project_comments_project_idx on public.project_comments (project_id, created_at);

alter table public.project_comments enable row level security;

create policy "comments: members read on published projects, moderators read all"
  on public.project_comments
  for select
  to authenticated
  using (
    public.is_moderator()
    or (public.is_member() and exists (
          select 1 from public.projects p
           where p.id = project_id and p.status = 'published'))
  );

create policy "comments: members comment on published projects"
  on public.project_comments
  for insert
  to authenticated
  with check (
    public.is_member()
    and author_id = (select auth.uid())
    and exists (
          select 1 from public.projects p
           where p.id = project_id and p.status = 'published')
  );

create policy "comments: moderators or the commenter can delete"
  on public.project_comments
  for delete
  to authenticated
  using (public.is_moderator() or author_id = (select auth.uid()));

revoke all on public.project_comments from anon, authenticated;
grant select, delete on public.project_comments to authenticated;
grant insert (project_id, author_id, body) on public.project_comments to authenticated;

-- ---------------------------------------------------------------- uploaded files
-- A private storage bucket: nothing in it has a public address. Files are
-- stored as <uploader's user id>/<random id>-<file name>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files', 'project-files', false, 10485760,  -- 10 MB
  array[
    'application/pdf',
    'image/png', 'image/jpeg',
    'text/plain', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

create policy "project files: members upload into their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'project-files'
    and public.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- A file can be read by moderators, or by a member when it belongs to a
-- published project or to one of their own submissions.
create policy "project files: read when the project is visible"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'project-files'
    and (
      public.is_moderator()
      or (public.is_member() and exists (
            select 1 from public.projects p
             where p.file_path = storage.objects.name
               and (p.status = 'published' or p.author_id = (select auth.uid()))))
    )
  );

create policy "project files: only moderators delete"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'project-files' and public.is_moderator());

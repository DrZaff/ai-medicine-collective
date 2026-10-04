-- 004: Learning Materials (reuses the projects pipeline)
--
-- Run once in the Supabase SQL Editor, after 001-003 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run).
--
-- Learning materials are rows in public.projects with kind = 'material', so
-- they get the same submit -> moderator review -> publish flow, comments,
-- file uploads and access rules as projects. What's new here:
--   * folders (Prompting, Vibe coding, App creation, ...) that moderators manage
--   * a material type (presentation, module, guide, video, other)
--   * a larger upload limit (25 MB) for slide decks

-- ---------------------------------------------------------------- folders

create table public.material_folders (
  name       text primary key check (char_length(name) between 2 and 60),
  position   integer not null default 100,  -- lower numbers are listed first
  created_at timestamptz not null default now()
);

comment on table public.material_folders is
  'Folders for learning materials. Approved members can read them; moderators add and rename them.';

alter table public.material_folders enable row level security;

create policy "material_folders: members read"
  on public.material_folders
  for select
  to authenticated
  using (public.is_member());

create policy "material_folders: moderators add"
  on public.material_folders
  for insert
  to authenticated
  with check (public.is_moderator());

create policy "material_folders: moderators rename or reorder"
  on public.material_folders
  for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- No delete policy: an empty folder is harmless, and deleting one that has
-- materials would orphan them.

revoke all on public.material_folders from anon, authenticated;
grant select on public.material_folders to authenticated;
grant insert (name, position) on public.material_folders to authenticated;
grant update (name, position) on public.material_folders to authenticated;

insert into public.material_folders (name, position) values
  ('Prompting', 10),
  ('Vibe coding', 20),
  ('App creation', 30),
  ('Custom GPTs and agents', 40),
  ('AI fundamentals', 50),
  ('Ethics and safety', 60),
  ('Other', 900);

-- ---------------------------------------------------------------- projects: kind + folder

alter table public.projects
  add column kind text not null default 'project'
    constraint projects_kind_check check (kind in ('project', 'material')),
  add column folder text
    constraint projects_folder_fkey references public.material_folders (name) on update cascade;

-- Replace the category rule from 003 (projects only) with one that depends on
-- kind. Looked up by definition so this works whatever name the old rule got.
do $$
declare
  rule record;
begin
  for rule in
    select conname
      from pg_constraint
     where conrelid = 'public.projects'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.projects drop constraint %I', rule.conname);
  end loop;
end;
$$;

alter table public.projects
  add constraint projects_category_check check (
    (kind = 'project' and category in (
       'Medical education', 'Patient care', 'Research', 'Guidelines',
       'Learning', 'Lifestyle', 'Productivity', 'Other'))
    or
    (kind = 'material' and category in (
       'Presentation', 'Module', 'Guide', 'Video', 'Other'))
  ),
  -- materials must be in a folder; projects must not be
  add constraint projects_folder_check check ((kind = 'material') = (folder is not null));

create index projects_kind_status_idx on public.projects (kind, status, created_at desc);

-- Members may set kind and folder when submitting, and move their own
-- unpublished material to another folder. kind can't be changed afterwards.
grant insert (kind, folder) on public.projects to authenticated;
grant update (folder) on public.projects to authenticated;

-- ---------------------------------------------------------------- uploads
-- Slide decks are often larger than 10 MB.

update storage.buckets
   set file_size_limit = 26214400  -- 25 MB
 where id = 'project-files';

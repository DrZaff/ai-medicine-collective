-- 025: Member Creations (new categories by interest, preview pictures)
--
-- Run once in the Supabase SQL Editor, after 001-024 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). Running it a second time does no
-- harm.
--
-- What it does:
--   1. Replaces the categories of creations (kind = 'project') with the list
--      the owner approved, grouped by what a visitor is looking for, and moves
--      every existing creation to its new category first. Learning materials
--      (kind = 'material') keep their types unchanged.
--   2. Adds projects.preview_path: an optional preview picture, stored in a
--      new PUBLIC storage bucket, creation-previews (PNG, JPEG or WebP, up to
--      2 MB). Anyone can see a preview; a member can upload, replace or delete
--      files only in their own folder (<their user id>/...). Authors set the
--      preview on their own unpublished creations, like every other field;
--      moderators can set or clear it on any creation with
--      set_project_preview().
--
-- The site works before and after this runs: until then it maps the old
-- category names onto the new groups in the browser and hides the preview
-- upload.

-- ---------------------------------------------------------------- 1. categories

-- Drop the category rule from 004, looked up by definition as 004 did.
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

-- Existing creations move to their new group (old names only, so a second
-- run changes nothing).
update public.projects
   set category = case category
         when 'Patient care'      then 'Clinical tools & calculators'
         when 'Guidelines'        then 'Clinical tools & calculators'
         when 'Medical education' then 'Study tools & Anki add-ons'
         when 'Learning'          then 'Study tools & Anki add-ons'
         when 'Research'          then 'Research tools'
         when 'Lifestyle'         then 'Lifestyle & wellbeing'
         when 'Productivity'      then 'Other'
         else category
       end
 where kind = 'project'
   and category in ('Patient care', 'Guidelines', 'Medical education', 'Learning',
                    'Research', 'Lifestyle', 'Productivity');

-- The Neapolitan Personality Quiz (a custom GPT that tells you your ice-cream
-- personality) is just for fun: Games, not among the clinical tools
update public.projects
   set category = 'Games'
 where kind = 'project'
   and category = 'Other'
   and (title = 'Neapolitan Personality Quiz'
        or link_url like 'https://chatgpt.com/g/g-68c8846d98948191a1bfba004e2b1dbf%');

alter table public.projects
  add constraint projects_category_check check (
    (kind = 'project' and category in (
       'Clinical tools & calculators', 'Study tools & Anki add-ons', 'Games',
       'AI assistants & GPTs', 'Research tools', 'Lifestyle & wellbeing',
       'Websites', 'Other'))
    or
    (kind = 'material' and category in (
       'Presentation', 'Module', 'Guide', 'Video', 'Other'))
  );

-- ---------------------------------------------------------------- 2. preview pictures

alter table public.projects
  add column if not exists preview_path text
    constraint projects_preview_path_check check (char_length(preview_path) <= 300);

comment on column public.projects.preview_path is
  'Optional preview picture: a path in the public creation-previews bucket, inside the uploader''s own folder.';

-- Visitors read it with the other public columns (007); members already have
-- table-wide select. Authors may set it when submitting or editing.
grant select (preview_path) on public.projects to anon;
grant insert (preview_path) on public.projects to authenticated;
grant update (preview_path) on public.projects to authenticated;

-- A preview must be one the author uploaded into their own folder: the insert
-- and author-update policies from 003 are replaced with versions that also
-- check preview_path (everything else is unchanged).
drop policy if exists "projects: members submit their own" on public.projects;
create policy "projects: members submit their own"
  on public.projects
  for insert
  to authenticated
  with check (
    public.is_member()
    and author_id = (select auth.uid())
    and (file_path is null or file_path like (select auth.uid())::text || '/%')
    and (preview_path is null or preview_path like (select auth.uid())::text || '/%')
  );

drop policy if exists "projects: authors edit own unpublished" on public.projects;
create policy "projects: authors edit own unpublished"
  on public.projects
  for update
  to authenticated
  using (author_id = (select auth.uid()) and status in ('pending', 'rejected'))
  with check (
    author_id = (select auth.uid())
    and (file_path is null or file_path like (select auth.uid())::text || '/%')
    and (preview_path is null or preview_path like (select auth.uid())::text || '/%')
  );

-- Moderators can set or clear the preview of any creation (published ones
-- included) without being able to change anything else about it. The picture
-- must be in the moderator's own folder, or the one the item already has.
create or replace function public.set_project_preview(target uuid, new_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can change a published preview';
  end if;
  if new_path is not null
     and new_path not like (select auth.uid())::text || '/%'
     and not exists (select 1 from public.projects p where p.id = target and p.preview_path = new_path) then
    raise exception 'The preview must be a picture you uploaded';
  end if;

  update public.projects
     set preview_path = new_path
   where id = target and kind = 'project';

  if not found then
    raise exception 'No such creation';
  end if;
end;
$$;

revoke execute on function public.set_project_preview(uuid, text) from public, anon;
grant execute on function public.set_project_preview(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 3. the public bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creation-previews', 'creation-previews', true, 2097152,  -- 2 MB
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
   set public = true,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "creation previews: anyone can read" on storage.objects;
create policy "creation previews: anyone can read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'creation-previews');

drop policy if exists "creation previews: members upload into their own folder" on storage.objects;
create policy "creation previews: members upload into their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'creation-previews'
    and public.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "creation previews: members replace their own" on storage.objects;
create policy "creation previews: members replace their own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'creation-previews'
    and public.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'creation-previews'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "creation previews: owner or moderator deletes" on storage.objects;
create policy "creation previews: owner or moderator deletes"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'creation-previews'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_moderator())
  );

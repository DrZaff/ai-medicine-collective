-- 010: new projects announce themselves in chat
--
-- Run once in the Supabase SQL Editor, after 001-009 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, publishing a project simply posts nothing.
--
-- When a moderator publishes a project, one message is posted in the
-- "Show and tell" chat topic, in the moderator's name, linking to the
-- project. Learning materials are not announced. Each project is announced
-- at most once. If the topic has been renamed or archived, nothing is posted.

-- Which project a chat message is about (only set by the function below;
-- members can't set it, because their insert grant doesn't include it).
alter table public.chat_messages
  add column project_id uuid references public.projects (id) on delete cascade;

create index chat_messages_project_idx on public.chat_messages (project_id)
  where project_id is not null;

create function public.announce_published_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  topic       uuid;
  author_name text;
begin
  select t.id into topic
    from public.chat_topics t
   where t.name = 'Show and tell' and not t.archived
   limit 1;

  if topic is null then
    return new;
  end if;

  -- Already announced (e.g. unpublished and published again)
  if exists (select 1 from public.chat_messages m where m.project_id = new.id) then
    return new;
  end if;

  select p.full_name into author_name from public.profiles p where p.id = new.author_id;

  insert into public.chat_messages (topic_id, author_id, body, project_id)
  values (
    topic,
    -- The moderator who published it; the author if there is no signed-in
    -- person (a change made from the SQL Editor)
    coalesce((select auth.uid()), new.author_id),
    format('New in the hub: "%s" by %s. Take a look and tell them what you think.',
           new.title, coalesce(nullif(btrim(author_name), ''), 'a member')),
    new.id
  );

  return new;
end;
$$;

revoke execute on function public.announce_published_project() from public, anon, authenticated;

create trigger projects_announce_published
  after update of status on public.projects
  for each row
  when (new.status = 'published' and old.status is distinct from new.status and new.kind = 'project')
  execute function public.announce_published_project();

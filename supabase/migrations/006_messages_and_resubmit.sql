-- 006: private messages to authors, and resubmitting a rejected item
--
-- Run once in the Supabase SQL Editor, after 001-005 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run).
--
-- 1. "Contact the author" becomes a private message inside the site, so
--    nobody's email address is shown. Only the sender and the recipient can
--    read a message; not other members, and not moderators.
-- 2. Authors can send a rejected project or material back for review after
--    editing it.
-- 3. Archived chat topics (and their messages) become unreadable to members,
--    matching the new ARCHIVE TOPIC button. Moderators can still read them.
-- 4. Members' email addresses stop being readable by other members.
--
-- ORDER MATTERS for this one: deploy the matching site code FIRST, then run
-- this file. The older site code reads the email column that step 4 locks.

-- ---------------------------------------------------------------- messages

create table public.project_messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  sender_id    uuid not null
               constraint project_messages_sender_id_fkey references public.profiles (id) on delete cascade,
  recipient_id uuid not null
               constraint project_messages_recipient_id_fkey references public.profiles (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);

comment on table public.project_messages is
  'Private messages about a project or material, between a member and its author. Readable only by the two people involved.';

create index project_messages_recipient_idx on public.project_messages (recipient_id, read_at, created_at desc);
create index project_messages_thread_idx on public.project_messages (project_id, created_at);

alter table public.project_messages enable row level security;

-- May the caller message this person about this project?
--   yes, if the recipient is the author of that published project (first contact)
--   yes, if the recipient already messaged the caller about it (a reply)
-- SECURITY DEFINER so it can check both without depending on what the caller
-- is allowed to read.
create function public.can_message(about_project uuid, to_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_member()
     and to_person <> (select auth.uid())
     and (
       exists (
         select 1 from public.projects p
          where p.id = about_project
            and p.author_id = to_person
            and p.status = 'published')
       or exists (
         select 1 from public.project_messages m
          where m.project_id = about_project
            and m.sender_id = to_person
            and m.recipient_id = (select auth.uid()))
     );
$$;

create policy "project_messages: only the two people involved can read"
  on public.project_messages
  for select
  to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy "project_messages: members write to an author, or reply"
  on public.project_messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.can_message(project_id, recipient_id)
  );

-- The recipient can mark a message as read (only read_at is grantable below).
create policy "project_messages: recipient marks as read"
  on public.project_messages
  for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- No delete policy: messages go away only when the project or an account is deleted.

revoke all on public.project_messages from anon, authenticated;
grant select on public.project_messages to authenticated;
grant insert (project_id, sender_id, recipient_id, body) on public.project_messages to authenticated;
grant update (read_at) on public.project_messages to authenticated;

revoke execute on function public.can_message(uuid, uuid) from public, anon;
grant execute on function public.can_message(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- resubmit
-- Status can't be edited directly. After fixing a rejected item, its author
-- calls this to put it back in the review queue.

create function public.resubmit_project(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
     set status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null
   where id = target
     and author_id = (select auth.uid())
     and status = 'rejected';

  if not found then
    raise exception 'Only the author can resubmit, and only an item that was not approved';
  end if;
end;
$$;

revoke execute on function public.resubmit_project(uuid) from public, anon;
grant execute on function public.resubmit_project(uuid) to authenticated;

-- ---------------------------------------------------------------- archived chat topics
-- The chat page now lets moderators archive a topic. Make "archived" real in
-- the database too: members can no longer read an archived topic or its
-- messages (moderators still can, so they can restore it).

drop policy "chat_topics: members read" on public.chat_topics;
create policy "chat_topics: members read active topics, moderators read all"
  on public.chat_topics
  for select
  to authenticated
  using (public.is_moderator() or (public.is_member() and not archived));

drop policy "chat_messages: members read" on public.chat_messages;
create policy "chat_messages: members read messages in active topics, moderators read all"
  on public.chat_messages
  for select
  to authenticated
  using (
    public.is_moderator()
    or (public.is_member() and exists (
          select 1 from public.chat_topics t
           where t.id = topic_id and not t.archived))
  );

-- ---------------------------------------------------------------- private emails
-- Until now an approved member could read other members' email addresses by
-- querying the profiles table directly (no page showed them). Close that:
-- members can read names, pictures and roles only. A person's own email comes
-- from their sign-in session; moderators get the list through member_emails().

revoke select on public.profiles from authenticated;
grant select (id, full_name, avatar_url, role, created_at, approved_at, approved_by)
  on public.profiles to authenticated;

create function public.member_emails()
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email
    from public.profiles p
   where public.is_moderator();
$$;

revoke execute on function public.member_emails() from public, anon;
grant execute on function public.member_emails() to authenticated;

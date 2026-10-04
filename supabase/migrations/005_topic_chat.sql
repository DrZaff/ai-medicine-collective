-- 005: Topic chat
--
-- Run once in the Supabase SQL Editor, after 001-004 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run).
--
-- Approved members chat inside topics. Moderators create topics and can delete
-- any message; members can delete their own. Signed-out visitors and people
-- whose membership is still pending can read nothing.

-- ---------------------------------------------------------------- topics

create table public.chat_topics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (char_length(name) between 2 and 60),
  description text check (char_length(description) <= 200),
  position    integer not null default 100,  -- lower numbers are listed first
  archived    boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.chat_topics is
  'Chat topics. Approved members read them; moderators add, rename, reorder and archive them.';

alter table public.chat_topics enable row level security;

create policy "chat_topics: members read"
  on public.chat_topics
  for select
  to authenticated
  using (public.is_member());

create policy "chat_topics: moderators add"
  on public.chat_topics
  for insert
  to authenticated
  with check (public.is_moderator());

create policy "chat_topics: moderators change"
  on public.chat_topics
  for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- No delete policy: archive a topic instead, so its history isn't lost.

revoke all on public.chat_topics from anon, authenticated;
grant select on public.chat_topics to authenticated;
grant insert (name, description, position, created_by) on public.chat_topics to authenticated;
grant update (name, description, position, archived) on public.chat_topics to authenticated;

insert into public.chat_topics (name, description, position) values
  ('General', 'Anything about AI in medicine.', 10),
  ('Prompting help', 'Stuck on a prompt? Ask here.', 20),
  ('Tools and apps', 'Tools you are trying, building, or recommending.', 30),
  ('Medical education', 'Using AI for teaching and learning.', 40),
  ('Research', 'Papers, methods, and study ideas.', 50),
  ('Show and tell', 'Share what you made this week.', 60);

-- ---------------------------------------------------------------- messages

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.chat_topics (id) on delete cascade,
  author_id  uuid not null
             constraint chat_messages_author_id_fkey references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'Chat messages from approved members, one topic each.';

create index chat_messages_topic_created_idx on public.chat_messages (topic_id, created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages: members read"
  on public.chat_messages
  for select
  to authenticated
  using (public.is_member());

-- A member posts as themselves, into a topic that isn't archived.
create policy "chat_messages: members post as themselves"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    public.is_member()
    and author_id = (select auth.uid())
    and exists (
          select 1 from public.chat_topics t
           where t.id = topic_id and not t.archived)
  );

create policy "chat_messages: moderators or the author can delete"
  on public.chat_messages
  for delete
  to authenticated
  using (public.is_moderator() or author_id = (select auth.uid()));

-- No update policy: messages can't be edited after posting.

revoke all on public.chat_messages from anon, authenticated;
grant select, delete on public.chat_messages to authenticated;
grant insert (topic_id, author_id, body) on public.chat_messages to authenticated;

-- ---------------------------------------------------------------- live updates
-- Lets the chat page receive new messages as they are posted. The row-level
-- rules above still apply to what each person is sent.

alter publication supabase_realtime add table public.chat_messages;

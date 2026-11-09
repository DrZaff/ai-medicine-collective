-- 022_content_reports.sql
-- Reporting and removing content (national-readiness audit, 2026-11-08).
--
-- Why: members could not report anything, so harmful posts were only found
-- if a moderator happened to see them; and private messages could not be
-- removed by anyone, even if they contained patient information (Rule 3:
-- "give moderators a way to remove content").
--
-- What this adds:
--   * public.content_reports: one row per report. No table grants: everything
--     goes through the functions below.
--   * report_content(kind, target, reason, details): any approved member
--     reports a chat message, comment, tool, request, private message (only
--     one they sent or received) or profile. The reported text is copied into
--     the report, so moderators can judge a private message without being able
--     to read anyone's inbox. Up to 20 reports an hour per member; one open
--     report per member per item.
--   * moderation_reports(): open reports, for moderators.
--   * resolve_report(report, action): a moderator removes the content (or
--     clears a profile's text) or dismisses the report; every open report on
--     the same item closes with it. Returns the tool's file path when a tool
--     with a file is removed, so the page can delete the file too.
--   * delete_private_message(message): the sender or the recipient can delete
--     a message from the conversation (removing it for both), and so can a
--     moderator.
--
-- Run once in the Supabase SQL Editor (after 021).

create table public.content_reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('chat', 'comment', 'project', 'request', 'message', 'profile')),
  target_id     uuid not null,
  target_author uuid references public.profiles (id) on delete set null,
  reason        text not null check (reason in ('patient_information', 'harassment', 'spam', 'misinformation', 'impersonation', 'other')),
  details       text check (char_length(details) <= 500),
  snapshot      text check (char_length(snapshot) <= 4000),
  status        text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles (id) on delete set null
);

comment on table public.content_reports is
  'Reports of chat messages, comments, tools, requests, private messages and profiles. Read and changed only through report_content, moderation_reports and resolve_report.';

alter table public.content_reports enable row level security;
-- No policies and no grants: members and moderators use the functions.

create index content_reports_open on public.content_reports (created_at) where status = 'open';
create unique index content_reports_one_open_each
  on public.content_reports (reporter_id, kind, target_id) where status = 'open';

-- ---------------------------------------------------------------- report

create or replace function public.report_content(p_kind text, p_target uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  author uuid;
  copy text;
  new_id uuid;
begin
  if not public.is_member() then
    raise exception 'Only approved members can report content.' using errcode = '42501';
  end if;
  if (select count(*) from public.content_reports r
       where r.reporter_id = me and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports in the last hour. Please try again later.' using errcode = '54000';
  end if;

  -- Find the item, check the reporter can see it, and copy its text
  if p_kind = 'chat' then
    select m.author_id, m.body into author, copy from public.chat_messages m where m.id = p_target;
  elsif p_kind = 'comment' then
    select c.author_id, c.body into author, copy from public.project_comments c where c.id = p_target;
  elsif p_kind = 'project' then
    select p.author_id, p.title || E'\n\n' || p.description || coalesce(E'\n\nLink: ' || p.link_url, '')
           || coalesce(E'\nFile: ' || p.file_name, '')
      into author, copy
      from public.projects p
     where p.id = p_target and (p.status = 'published' or p.author_id = me or public.is_moderator());
  elsif p_kind = 'request' then
    select q.author_id, q.title || coalesce(E'\n\n' || q.details, '') into author, copy
      from public.tool_requests q where q.id = p_target;
  elsif p_kind = 'message' then
    select m.sender_id, m.body into author, copy
      from public.project_messages m
     where m.id = p_target and me in (m.sender_id, m.recipient_id);
  elsif p_kind = 'profile' then
    select p.id, concat_ws(E'\n', p.full_name, p.program, p.training_level, p.focus_areas, p.bio, p.contact_email, p.link_url)
      into author, copy
      from public.profiles p
     where p.id = p_target and p.role in ('member', 'moderator', 'admin');
  else
    raise exception 'Unknown kind of content.' using errcode = '22023';
  end if;

  if author is null then
    raise exception 'That item no longer exists, or you cannot see it.' using errcode = 'P0002';
  end if;

  insert into public.content_reports (reporter_id, kind, target_id, target_author, reason, details, snapshot)
  values (me, p_kind, p_target, author, p_reason, nullif(left(btrim(coalesce(p_details, '')), 500), ''), left(copy, 4000))
  on conflict (reporter_id, kind, target_id) where status = 'open' do update
    set reason = excluded.reason, details = excluded.details, created_at = now()
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------- moderators read

create or replace function public.moderation_reports()
returns table (
  id uuid, kind text, target_id uuid, reason text, details text, snapshot text, created_at timestamptz,
  reporter_name text, author_id uuid, author_name text, reports_on_item bigint, project_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can see reports.' using errcode = '42501';
  end if;
  return query
    select r.id, r.kind, r.target_id, r.reason, r.details, r.snapshot, r.created_at,
           rp.full_name, r.target_author, ap.full_name,
           count(*) over (partition by r.kind, r.target_id),
           case r.kind
             when 'project' then r.target_id
             when 'comment' then (select c.project_id from public.project_comments c where c.id = r.target_id)
             else null
           end
      from public.content_reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles ap on ap.id = r.target_author
     where r.status = 'open'
     order by (r.reason = 'patient_information') desc, r.created_at;
end;
$$;

-- ---------------------------------------------------------------- moderators act

create or replace function public.resolve_report(p_report uuid, p_action text)
returns text  -- the removed tool's file path, if any (the page deletes the file)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.content_reports;
  file text;
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can act on reports.' using errcode = '42501';
  end if;
  select * into rep from public.content_reports where id = p_report;
  if rep.id is null or rep.status <> 'open' then
    raise exception 'That report is already closed.' using errcode = 'P0002';
  end if;
  if p_action not in ('remove', 'dismiss') then
    raise exception 'Choose remove or dismiss.' using errcode = '22023';
  end if;

  if p_action = 'remove' then
    if rep.kind = 'chat' then
      delete from public.chat_messages where id = rep.target_id;
    elsif rep.kind = 'comment' then
      delete from public.project_comments where id = rep.target_id;
    elsif rep.kind = 'project' then
      delete from public.projects where id = rep.target_id returning file_path into file;
    elsif rep.kind = 'request' then
      delete from public.tool_requests where id = rep.target_id;
    elsif rep.kind = 'message' then
      delete from public.project_messages where id = rep.target_id;
    elsif rep.kind = 'profile' then
      -- Keep the account; clear what the person wrote about themselves and
      -- leave them off the member list until a moderator restores them
      update public.profiles
         set bio = null, focus_areas = null, contact_email = null, link_url = null, hidden_by_moderator = true
       where id = rep.target_id;
    end if;
  end if;

  update public.content_reports
     set status = case when p_action = 'remove' then 'removed' else 'dismissed' end,
         resolved_at = now(), resolved_by = auth.uid()
   where kind = rep.kind and target_id = rep.target_id and status = 'open';
  return file;
end;
$$;

-- ---------------------------------------------------------------- private messages

create or replace function public.delete_private_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.project_messages m
   where m.id = p_message
     and (auth.uid() in (m.sender_id, m.recipient_id) or public.is_moderator());
  if not found then
    raise exception 'That message no longer exists, or it is not yours to delete.' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------- who may call what

revoke all on function public.report_content(text, uuid, text, text) from public, anon;
revoke all on function public.moderation_reports() from public, anon;
revoke all on function public.resolve_report(uuid, text) from public, anon;
revoke all on function public.delete_private_message(uuid) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;
grant execute on function public.moderation_reports() to authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;
grant execute on function public.delete_private_message(uuid) to authenticated;

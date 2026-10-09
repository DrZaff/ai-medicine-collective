-- 019: moderators can hide a member from the member list; admins can delete
--      a duplicate sign-up
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). It does not depend on 018, which is part of
-- work that has not been merged; running 019 without 018 is fine. The site
-- works before and after this file; until it has run, the Moderation page
-- simply does not show the two new buttons.
--
-- 1. hidden_by_moderator: a second, separate switch from the member's own
--    "Show me in the member list" choice (directory_listing). A member cannot
--    change it; only set_member_hidden() can. Like the member's own choice it
--    is about the list, not secrecy: the person's profile page still opens for
--    members who have its address.
--
-- 2. delete_account(): removes a sign-up completely (the sign-in itself, and
--    with it the profile and join details). Meant for duplicates: the same
--    person signed up twice with two addresses. It refuses to delete
--      * your own account,
--      * a moderator or admin (change their role first),
--      * an account that has posted anything (projects, materials, comments,
--        chat messages, private messages, tool requests), because deleting it
--        would erase those too. Hide such an account instead.
--    Deleting cannot be undone.

alter table public.profiles
  add column hidden_by_moderator boolean not null default false;

comment on column public.profiles.hidden_by_moderator is
  'Set by a moderator to leave this person off the member list. The member cannot change it.';

-- Readable (the member list needs it), but not writable: there is no
-- "grant update" for this column, so only the function below can change it.
grant select (hidden_by_moderator) on public.profiles to authenticated;

create function public.set_member_hidden(target uuid, hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Only moderators can hide or show members';
  end if;

  update public.profiles set hidden_by_moderator = hidden where id = target;

  if not found then
    raise exception 'No such person';
  end if;
end;
$$;

create function public.delete_account(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.member_role;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete accounts';
  end if;

  if target = (select auth.uid()) then
    raise exception 'You cannot delete your own account here';
  end if;

  select role into target_role from public.profiles where id = target;
  if not found then
    raise exception 'No such person';
  end if;

  if target_role in ('moderator', 'admin') then
    raise exception 'Change this person''s role to Member first';
  end if;

  if exists (select 1 from public.projects where author_id = target)
     or exists (select 1 from public.project_comments where author_id = target)
     or exists (select 1 from public.chat_messages where author_id = target)
     or exists (select 1 from public.project_messages where sender_id = target or recipient_id = target)
     or exists (select 1 from public.tool_requests where author_id = target)
  then
    raise exception 'This account has posted or received content that deleting it would erase. Hide it from the member list instead.';
  end if;

  -- Removing the sign-in removes the profile and join details with it
  delete from auth.users where id = target;
end;
$$;

revoke execute on function public.set_member_hidden(uuid, boolean) from public, anon;
revoke execute on function public.delete_account(uuid) from public, anon;
grant execute on function public.set_member_hidden(uuid, boolean) to authenticated;
grant execute on function public.delete_account(uuid) to authenticated;

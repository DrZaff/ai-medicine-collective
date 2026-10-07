-- 016: monthly meeting poll, confirmation, and calendar invite
--
-- Run once in the Supabase SQL Editor, after 001-015 (Dashboard > SQL Editor >
-- New query > paste this whole file > Run). The site works before and after
-- this file; until it has run, the Meetings page says the poll isn't
-- available yet. Uses the Resend key already stored in Vault (011).
--
-- The Collective meets in the first week of each month. For next month's
-- meeting, approved members tick every half-hour slot they could make,
-- between 4:00 and 7:00 PM Eastern on days 1 to 7 of that month. Voting
-- closes one week before the end of the current month. An admin then
-- confirms a slot (the page shows the most-voted first), and everyone who
-- ticked that slot is emailed a confirmation with a calendar invite.
--
-- Everything here is members-only, and all changes go through functions:
-- nobody writes to these tables directly.

-- ---------------------------------------------------------------- tables

create table public.meeting_votes (
  slot       timestamptz not null,
  user_id    uuid not null
             constraint meeting_votes_user_id_fkey references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (slot, user_id)
);

comment on table public.meeting_votes is
  'Half-hour slots members said they could make for a month''s meeting.';

create table public.meetings (
  month        date primary key,            -- first day of the month the meeting is in
  starts_at    timestamptz not null,
  minutes      integer not null default 30 check (minutes between 15 and 240),
  place        text check (char_length(place) <= 300),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  emailed      integer not null default 0
);

comment on table public.meetings is
  'The confirmed monthly meeting, one row per month.';

alter table public.meeting_votes enable row level security;
alter table public.meetings enable row level security;

-- No policies and no grants: the functions below are the only way in.
revoke all on public.meeting_votes from anon, authenticated;
revoke all on public.meetings from anon, authenticated;

-- ---------------------------------------------------------------- helpers

-- The month being voted on: next month, by the Eastern calendar.
create function public.meeting_poll_month()
returns date
language sql
stable
set search_path = ''
as $$
  select (date_trunc('month', now() at time zone 'America/New_York') + interval '1 month')::date;
$$;

-- Voting for a month closes at the start of the day one week before the end
-- of the month before it.
create function public.meeting_poll_closes(target date)
returns date
language sql
immutable
set search_path = ''
as $$
  select (target - 1) - 7;
$$;

-- The 42 slots for a month: days 1-7, every half hour from 4:00 to 6:30 PM
-- Eastern (the last slot ends at 7:00).
create function public.meeting_slots(target date)
returns setof timestamptz
language sql
stable
set search_path = ''
as $$
  select (d + t) at time zone 'America/New_York'
    from generate_series(target::timestamp, target::timestamp + interval '6 days', interval '1 day') d
   cross join generate_series(interval '16 hours', interval '18 hours 30 minutes', interval '30 minutes') t
   order by 1;
$$;

revoke execute on function public.meeting_poll_month() from public, anon;
revoke execute on function public.meeting_poll_closes(date) from public, anon;
revoke execute on function public.meeting_slots(date) from public, anon;
grant execute on function public.meeting_poll_month() to authenticated;
grant execute on function public.meeting_poll_closes(date) to authenticated;
grant execute on function public.meeting_slots(date) to authenticated;

-- ---------------------------------------------------------------- read
-- Everything the Meetings page needs, in one answer.

create function public.meeting_poll()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target date := public.meeting_poll_month();
  closes date := public.meeting_poll_closes(target);
  today  date := (now() at time zone 'America/New_York')::date;
  me     uuid := (select auth.uid());
begin
  if not public.is_member() then
    raise exception 'Members only';
  end if;

  return jsonb_build_object(
    'month', target,
    'closes_on', closes,
    'open', today < closes and not exists (select 1 from public.meetings m where m.month = target),
    'is_admin', public.is_admin(),
    'slots', (
      select jsonb_agg(jsonb_build_object(
               'slot', s,
               'votes', (select count(*) from public.meeting_votes v where v.slot = s),
               'mine', exists (select 1 from public.meeting_votes v where v.slot = s and v.user_id = me))
             order by s)
        from public.meeting_slots(target) s),
    -- Confirmed meetings that haven't finished yet (this month's and next month's)
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'month', m.month, 'starts_at', m.starts_at, 'minutes', m.minutes,
               'place', m.place, 'emailed', m.emailed,
               'going', (select count(*) from public.meeting_votes v where v.slot = m.starts_at))
             order by m.starts_at)
        from public.meetings m
       where m.starts_at + make_interval(mins => m.minutes) > now()), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------- vote

create function public.set_meeting_vote(target_slot timestamptz, can_attend boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target date := public.meeting_poll_month();
  today  date := (now() at time zone 'America/New_York')::date;
begin
  if not public.is_member() then
    raise exception 'Members only';
  end if;
  if today >= public.meeting_poll_closes(target)
     or exists (select 1 from public.meetings m where m.month = target) then
    raise exception 'Voting for this meeting has closed';
  end if;
  if not exists (select 1 from public.meeting_slots(target) s where s = target_slot) then
    raise exception 'That is not one of this month''s time slots';
  end if;

  if can_attend then
    insert into public.meeting_votes (slot, user_id)
    values (target_slot, (select auth.uid()))
    on conflict do nothing;
  else
    delete from public.meeting_votes
     where slot = target_slot and user_id = (select auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------- confirm
-- An admin picks the slot. Everyone who ticked it gets an email with a
-- calendar file attached. Returns how many people were emailed.

create function public.confirm_meeting(target_slot timestamptz, place text default null, length_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target   date := public.meeting_poll_month();
  api_key  text;
  me       uuid := (select auth.uid());
  spot     text := nullif(btrim(coalesce(place, '')), '');
  ends_at  timestamptz := target_slot + make_interval(mins => length_minutes);
  whenline text := to_char(target_slot at time zone 'America/New_York', 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM') || ' Eastern';
  stamp    text := 'YYYYMMDD"T"HH24MISS"Z"';
  ics      text;
  voter    record;
  total    integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can confirm the meeting';
  end if;
  if not exists (select 1 from public.meeting_slots(target) s where s = target_slot) then
    raise exception 'That is not one of this month''s time slots';
  end if;

  begin
    insert into public.meetings (month, starts_at, minutes, place, confirmed_by)
    values (target, target_slot, length_minutes, spot, me);
  exception when unique_violation then
    raise exception 'This month''s meeting is already confirmed. Undo it first to change it.';
  end;

  select s.decrypted_secret into api_key
    from vault.decrypted_secrets s
   where s.name = 'resend_api_key'
   limit 1;

  if api_key is null then
    return 0;  -- confirmed, but email isn't set up
  end if;

  -- A calendar file every calendar app can open (times in UTC)
  ics := 'BEGIN:VCALENDAR' || E'\r\n'
      || 'VERSION:2.0' || E'\r\n'
      || 'PRODID:-//AI Medicine Collective//Monthly meeting//EN' || E'\r\n'
      || 'METHOD:PUBLISH' || E'\r\n'
      || 'BEGIN:VEVENT' || E'\r\n'
      || 'UID:meeting-' || to_char(target, 'YYYY-MM') || '@aimedicinecollective.com' || E'\r\n'
      || 'DTSTAMP:' || to_char(now() at time zone 'UTC', stamp) || E'\r\n'
      || 'DTSTART:' || to_char(target_slot at time zone 'UTC', stamp) || E'\r\n'
      || 'DTEND:' || to_char(ends_at at time zone 'UTC', stamp) || E'\r\n'
      || 'SUMMARY:AI Medicine Collective monthly meeting' || E'\r\n'
      || coalesce('LOCATION:' || replace(replace(replace(replace(spot, E'\\', E'\\\\'), ';', E'\\;'), ',', E'\\,'), E'\n', ' ') || E'\r\n', '')
      || 'DESCRIPTION:Details: https://www.aimedicinecollective.com/schedule.html' || E'\r\n'
      || 'END:VEVENT' || E'\r\n'
      || 'END:VCALENDAR' || E'\r\n';

  for voter in
    select p.email
      from public.meeting_votes v
      join public.profiles p on p.id = v.user_id
     where v.slot = target_slot
       and p.email is not null
       and p.role in ('member', 'moderator', 'admin')
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'AI Medicine Collective <noreply@mail.aimedicinecollective.com>',
        'to', jsonb_build_array(voter.email),
        'subject', 'Confirmed: AI Medicine Collective meeting, ' || to_char(target_slot at time zone 'America/New_York', 'FMMonth FMDD'),
        'text',
          'The monthly meeting is confirmed for a time you said you could make.' || E'\n\n'
          || 'When: ' || whenline || ' (' || length_minutes || ' minutes)' || E'\n'
          || coalesce('Where: ' || spot || E'\n', '')
          || E'\n'
          || 'A calendar invite is attached: open it to add the meeting to your calendar.' || E'\n'
          || 'Details: https://www.aimedicinecollective.com/schedule.html',
        'attachments', jsonb_build_array(jsonb_build_object(
          'filename', 'ai-medicine-collective-meeting.ics',
          'content', replace(encode(convert_to(ics, 'UTF8'), 'base64'), E'\n', ''),
          'content_type', 'text/calendar'))
      )
    );
    total := total + 1;
  end loop;

  update public.meetings set emailed = total where month = target;
  return total;
end;
$$;

-- Take a confirmation back (to pick a different slot). Sends nothing.
create function public.undo_meeting(target date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can undo a confirmation';
  end if;
  delete from public.meetings where month = target;
end;
$$;

revoke execute on function public.meeting_poll() from public, anon;
revoke execute on function public.set_meeting_vote(timestamptz, boolean) from public, anon;
revoke execute on function public.confirm_meeting(timestamptz, text, integer) from public, anon;
revoke execute on function public.undo_meeting(date) from public, anon;
grant execute on function public.meeting_poll() to authenticated;
grant execute on function public.set_meeting_vote(timestamptz, boolean) to authenticated;
grant execute on function public.confirm_meeting(timestamptz, text, integer) to authenticated;
grant execute on function public.undo_meeting(date) to authenticated;

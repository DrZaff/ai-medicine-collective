-- 024: invite links and seats for Hospital Kombat online matches (games/hospital-kombat.html)
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). It does not depend on 023. Until it has run,
-- the game's "Play with a friend" button says online play isn't available
-- yet; Arcade and Same keyboard work either way.
--
-- How a match is set up:
--   1. The host presses "Play with a friend". kombat_create_room() makes a
--      room and returns a one-time invite (for the link), a private seat key
--      (kept in the host's browser tab) and the room's channel name.
--   2. The friend opens the link. kombat_join_room() gives them the second
--      and last seat, with their own seat key and the channel name.
--   3. Both browsers talk over Supabase Realtime on that private channel. The
--      host's browser runs the fight; the friend's sends button presses and
--      draws what the host sends back. Nothing about the match is stored.
--
-- Safeguards:
--   * Exactly two seats. The first person to open a link takes the guest
--     seat; anyone else with the same link is told the game is full.
--   * Invites are 128 random bits, work for 15 minutes, and are stored only as
--     hashes. Seat keys are 192 random bits, also stored as hashes. A room ends
--     3 hours after it was made, or as soon as the host leaves.
--   * The channel name is 128 random bits and is only ever given to the two
--     seat holders. The Realtime policies below only let anyone join a
--     kombat channel while its room is open, so a closed or expired room's
--     channel refuses new connections.
--   * Nobody can read the table. Visitors, signed in or not, only get the
--     functions below, which take and return nothing personal.
--   * At most 60 new rooms a minute overall; rooms are deleted a day after
--     they end.
--
-- Realtime: this needs Realtime's private channels, which are on by default.
-- Leave "Allow public access" on in Realtime settings: the chat page uses
-- public Postgres-changes channels.

create table public.kombat_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_hash text not null unique,
  channel text not null unique check (channel ~ '^kombat-[0-9a-f]{32}$'),
  host_hash text not null,
  guest_hash text,
  created_at timestamptz not null default now(),
  invite_expires_at timestamptz not null,
  expires_at timestamptz not null,
  closed_at timestamptz
);

comment on table public.kombat_rooms is
  'Hospital Kombat online rooms: two seats per room, reached only through kombat_create_room, kombat_join_room, kombat_resume, kombat_new_invite and kombat_leave. Invites and seat keys are stored as SHA-256 hashes.';

create index kombat_rooms_created_idx on public.kombat_rooms (created_at);
create index kombat_rooms_expires_idx on public.kombat_rooms (expires_at);

alter table public.kombat_rooms enable row level security;
-- No policies on purpose: nobody reads or writes the table directly.
revoke all on public.kombat_rooms from anon, authenticated;


-- Helpers (not callable by visitors).
create or replace function public.kombat_token(p_bytes integer)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/', '-_'), '=');
$$;

create or replace function public.kombat_hash(p_value text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_value, 'sha256'), 'hex');
$$;

create or replace function public.kombat_valid_token(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null and p_value ~ '^[A-Za-z0-9_-]{16,64}$';
$$;

revoke all on function public.kombat_token(integer) from public, anon, authenticated;
revoke all on function public.kombat_hash(text) from public, anon, authenticated;
revoke all on function public.kombat_valid_token(text) from public, anon, authenticated;


-- 1. Make a room. Returns the invite, the host's seat key and the channel.
create or replace function public.kombat_create_room()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_invite text := public.kombat_token(16);
  v_key text := public.kombat_token(24);
  r public.kombat_rooms%rowtype;
begin
  delete from public.kombat_rooms where expires_at < now() - interval '1 day';
  if (select count(*) from public.kombat_rooms where created_at > now() - interval '1 minute') >= 60 then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into public.kombat_rooms (invite_hash, channel, host_hash, invite_expires_at, expires_at)
  values (public.kombat_hash(v_invite), 'kombat-' || encode(extensions.gen_random_bytes(16), 'hex'),
          public.kombat_hash(v_key), now() + interval '15 minutes', now() + interval '3 hours')
  returning * into r;
  return jsonb_build_object('status', 'ok', 'role', 'host', 'room', r.id, 'invite', v_invite,
    'seat_key', v_key, 'channel', r.channel,
    'invite_expires_at', r.invite_expires_at, 'expires_at', r.expires_at);
end;
$$;


-- 2. Take the guest seat with an invite. Statuses: ok, invalid, expired, full.
-- A guest who already holds the seat (p_seat_key) gets it back; a host who
-- opens their own link is told so ('own').
create or replace function public.kombat_join_room(p_invite text, p_seat_key text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r public.kombat_rooms%rowtype;
  v_key text;
begin
  if not public.kombat_valid_token(p_invite) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not public.kombat_valid_token(p_seat_key) then
    p_seat_key := null;
  end if;
  select * into r from public.kombat_rooms where invite_hash = public.kombat_hash(p_invite) for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if r.closed_at is not null or r.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if p_seat_key is not null and r.host_hash = public.kombat_hash(p_seat_key) then
    return jsonb_build_object('status', 'own');
  end if;
  if p_seat_key is not null and r.guest_hash = public.kombat_hash(p_seat_key) then
    return jsonb_build_object('status', 'ok', 'role', 'guest', 'room', r.id, 'seat_key', p_seat_key,
      'channel', r.channel, 'expires_at', r.expires_at);
  end if;
  if r.guest_hash is not null then
    return jsonb_build_object('status', 'full');
  end if;
  if r.invite_expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  v_key := public.kombat_token(24);
  update public.kombat_rooms set guest_hash = public.kombat_hash(v_key) where id = r.id;
  return jsonb_build_object('status', 'ok', 'role', 'guest', 'room', r.id, 'seat_key', v_key,
    'channel', r.channel, 'expires_at', r.expires_at);
end;
$$;


-- 3. Get back into a room after a reload, with the seat key kept in the tab.
create or replace function public.kombat_resume(p_room uuid, p_seat_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r public.kombat_rooms%rowtype;
begin
  if p_room is null or not public.kombat_valid_token(p_seat_key) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into r from public.kombat_rooms where id = p_room;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if r.closed_at is not null or r.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if r.host_hash = public.kombat_hash(p_seat_key) then
    return jsonb_build_object('status', 'ok', 'role', 'host', 'room', r.id, 'seat_key', p_seat_key,
      'channel', r.channel, 'expires_at', r.expires_at, 'invite_expires_at', r.invite_expires_at,
      'guest_seated', r.guest_hash is not null);
  end if;
  if r.guest_hash = public.kombat_hash(p_seat_key) then
    return jsonb_build_object('status', 'ok', 'role', 'guest', 'room', r.id, 'seat_key', p_seat_key,
      'channel', r.channel, 'expires_at', r.expires_at);
  end if;
  return jsonb_build_object('status', 'invalid');
end;
$$;


-- 4. Host only: a fresh invite for the same room. Frees the guest seat and
-- moves the room to a new channel, so a friend who closed their tab, or the
-- wrong person, can be replaced, and whoever held the old seat can no longer
-- reach the room. The host's browser reconnects on the new channel.
create or replace function public.kombat_new_invite(p_room uuid, p_seat_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r public.kombat_rooms%rowtype;
  v_invite text := public.kombat_token(16);
begin
  if p_room is null or not public.kombat_valid_token(p_seat_key) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into r from public.kombat_rooms where id = p_room for update;
  if not found or r.host_hash <> public.kombat_hash(p_seat_key) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if r.closed_at is not null or r.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  update public.kombat_rooms
     set invite_hash = public.kombat_hash(v_invite), guest_hash = null,
         channel = 'kombat-' || encode(extensions.gen_random_bytes(16), 'hex'),
         invite_expires_at = least(now() + interval '15 minutes', r.expires_at)
   where id = r.id
  returning * into r;
  return jsonb_build_object('status', 'ok', 'invite', v_invite, 'channel', r.channel,
    'invite_expires_at', r.invite_expires_at);
end;
$$;


-- 5. Leave. The host closes the room; a guest gives their seat back (the
-- invite works again for anyone with it, if it hasn't expired).
create or replace function public.kombat_leave(p_room uuid, p_seat_key text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if p_room is null or not public.kombat_valid_token(p_seat_key) then
    return;
  end if;
  update public.kombat_rooms set closed_at = now()
   where id = p_room and host_hash = public.kombat_hash(p_seat_key) and closed_at is null;
  update public.kombat_rooms set guest_hash = null
   where id = p_room and guest_hash = public.kombat_hash(p_seat_key);
end;
$$;


-- Realtime: who may join a kombat channel. Only channels of open rooms; the
-- name itself is the secret that only the two seat holders are given.
create or replace function public.kombat_channel_open(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kombat_rooms
     where channel = p_topic and closed_at is null and expires_at > now()
  );
$$;

revoke all on function public.kombat_create_room() from public;
revoke all on function public.kombat_join_room(text, text) from public;
revoke all on function public.kombat_resume(uuid, text) from public;
revoke all on function public.kombat_new_invite(uuid, text) from public;
revoke all on function public.kombat_leave(uuid, text) from public;
revoke all on function public.kombat_channel_open(text) from public;
grant execute on function public.kombat_create_room() to anon, authenticated;
grant execute on function public.kombat_join_room(text, text) to anon, authenticated;
grant execute on function public.kombat_resume(uuid, text) to anon, authenticated;
grant execute on function public.kombat_new_invite(uuid, text) to anon, authenticated;
grant execute on function public.kombat_leave(uuid, text) to anon, authenticated;
grant execute on function public.kombat_channel_open(text) to anon, authenticated;

create policy "kombat: seat holders receive on open rooms"
  on realtime.messages for select to anon, authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'kombat-%'
    and public.kombat_channel_open((select realtime.topic()))
  );

create policy "kombat: seat holders send on open rooms"
  on realtime.messages for insert to anon, authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'kombat-%'
    and public.kombat_channel_open((select realtime.topic()))
  );

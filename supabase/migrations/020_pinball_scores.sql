-- 020: a public high-score board for Bearcat Pinball (games/bearcat-pinball.html)
--
-- Run once in the Supabase SQL Editor (Dashboard > SQL Editor > New query >
-- paste this whole file > Run). It does not depend on 018. The game works
-- before and after this file; until it has run, the game keeps scores on each
-- player's device, as it always has.
--
-- An arcade board: anyone, signed in or not, can see the top scores and post
-- their own under a nickname. Nobody touches the table directly. Visitors only
-- get two narrow functions:
--   pinball_leaderboard()   the top scores (nickname, score, rank reached),
--                           marking the caller's own entry
--   submit_pinball_score()  post a finished game's score
-- Safeguards:
--   * One entry per device: the game makes a random id once and keeps it in
--     the browser. A device's entry only ever moves up to a better score.
--   * Nicknames are 1 to 12 capital letters, digits, spaces, dots, dashes or
--     underscores, and must start with a letter or digit. The game says the
--     name is public and asks for no patient information.
--   * At most one post per device every 10 seconds, and 120 a minute overall.
--   * The device id is never returned, so nobody can post as someone else's
--     entry by reading the board.
--   * Moderators see every entry and can remove one (an offensive nickname,
--     an obviously fake score) on the Moderation page.
-- Scores come from the player's browser, so a determined person could post a
-- made-up number. That is the nature of a browser game; removal is the remedy.

create table public.pinball_scores (
  id bigint generated always as identity primary key,
  device_id uuid not null unique,
  name text not null check (name ~ '^[A-Z0-9][A-Z0-9 ._-]{0,11}$'),
  score integer not null check (score between 1 and 2000000000),
  rank smallint not null default 0 check (rank between 0 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pinball_scores is
  'Bearcat Pinball high scores: one best score per device. Read and written only through pinball_leaderboard() and submit_pinball_score(); moderators use pinball_scores_for_moderators() and remove_pinball_score().';

create index pinball_scores_board_idx on public.pinball_scores (score desc, updated_at);
create index pinball_scores_recent_idx on public.pinball_scores (updated_at);

alter table public.pinball_scores enable row level security;

-- No direct access for anyone: every read and write goes through the functions
-- below. The policy only matters if a grant is ever added by mistake.
revoke all on public.pinball_scores from anon, authenticated;
create policy "pinball scores: moderators read"
  on public.pinball_scores for select to authenticated
  using (public.is_moderator());


-- The top of the board. p_device marks the caller's own entry (mine = true).
create or replace function public.pinball_leaderboard(p_device uuid default null, p_limit integer default 10)
returns table (name text, score integer, rank smallint, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select s.name, s.score, s.rank, coalesce(s.device_id = p_device, false)
  from public.pinball_scores s
  order by s.score desc, s.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;


-- Post a finished game. Returns the device's place on the whole board and
-- whether an older, better score was kept (then nothing is written).
create or replace function public.submit_pinball_score(p_device uuid, p_name text, p_score integer, p_rank integer default 0)
returns table (place integer, kept boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text;
  prev public.pinball_scores%rowtype;
begin
  if p_device is null then
    raise exception 'missing device id';
  end if;
  if p_score is null or p_score < 1 or p_score > 2000000000 then
    raise exception 'score out of range';
  end if;

  -- Same cleaning as the game: capitals, allowed characters, single spaces,
  -- no leading punctuation, at most 12 characters.
  clean := upper(coalesce(p_name, ''));
  clean := regexp_replace(clean, '[^A-Z0-9 ._-]', '', 'g');
  clean := regexp_replace(clean, '\s+', ' ', 'g');
  clean := regexp_replace(clean, '^[ ._-]+', '');
  clean := btrim(left(clean, 12));
  if clean = '' then
    raise exception 'nickname needs a letter or digit';
  end if;

  select * into prev from public.pinball_scores where device_id = p_device;

  if found and prev.score >= p_score then
    return query
      select (select count(*)::integer + 1 from public.pinball_scores s where s.score > prev.score), true;
    return;
  end if;

  if found and prev.updated_at > now() - interval '10 seconds' then
    raise exception 'too many scores from this device; try again in a few seconds';
  end if;
  if (select count(*) from public.pinball_scores s where s.updated_at > now() - interval '1 minute') >= 120 then
    raise exception 'the board is busy; try again in a minute';
  end if;

  insert into public.pinball_scores as s (device_id, name, score, rank)
  values (p_device, clean, p_score, greatest(0, least(coalesce(p_rank, 0), 7)))
  on conflict (device_id) do update
    set name = excluded.name, score = excluded.score, rank = excluded.rank, updated_at = now()
    where s.score < excluded.score;

  return query
    select (select count(*)::integer + 1 from public.pinball_scores s where s.score > p_score), false;
end;
$$;


-- Moderators: every entry, best first, with its id for removal.
create or replace function public.pinball_scores_for_moderators()
returns table (id bigint, name text, score integer, rank smallint, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'moderators only';
  end if;
  return query
    select s.id, s.name, s.score, s.rank, s.updated_at
    from public.pinball_scores s
    order by s.score desc, s.updated_at asc
    limit 200;
end;
$$;

create or replace function public.remove_pinball_score(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'moderators only';
  end if;
  delete from public.pinball_scores where id = p_id;
end;
$$;


revoke all on function public.pinball_leaderboard(uuid, integer) from public;
revoke all on function public.submit_pinball_score(uuid, text, integer, integer) from public;
revoke all on function public.pinball_scores_for_moderators() from public;
revoke all on function public.remove_pinball_score(bigint) from public;

grant execute on function public.pinball_leaderboard(uuid, integer) to anon, authenticated;
grant execute on function public.submit_pinball_score(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.pinball_scores_for_moderators() to authenticated;
grant execute on function public.remove_pinball_score(bigint) to authenticated;

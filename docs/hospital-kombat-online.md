# Hospital Kombat online play: setup and checks

"Play with a friend" on `games/hospital-kombat.html` lets one player send a link
and the friend who opens it join the same match. It runs on the site's existing
Supabase project. Nothing else needs to be signed up for.

## How it works

1. **Seats and invites (database).** Migration `024_kombat_rooms.sql` adds the
   table `kombat_rooms` and five functions that visitors can call, signed in or
   not: `kombat_create_room`, `kombat_join_room`, `kombat_resume`,
   `kombat_new_invite` and `kombat_leave`. Nobody can read the table itself.
   Each room has exactly two seats. Invites are 128 random bits and work for 15
   minutes; seat keys are 192 random bits; both are stored only as SHA-256
   hashes. A room ends 3 hours after it was made or when its host leaves, and
   is deleted a day later. At most 60 rooms can be made a minute.
2. **Match traffic (Supabase Realtime).** Each room has a private Realtime
   channel whose name (128 random bits) only the two seat holders are given.
   The migration's two policies on `realtime.messages` let anyone join a
   `kombat-…` channel only while its room is open, so an expired or closed
   room's channel refuses new connections. A host's "Make a new link" also
   moves the room to a new channel, which shuts out whoever held the old seat.
3. **The game.** The host's browser runs the fight and sends the match state
   20 times a second; the friend's browser sends button presses and draws what
   it receives, gliding between updates. Both browsers check every message's
   role, shape, value ranges and size before using it.

## Setup (owner, once)

1. Open the Supabase dashboard > SQL Editor > New query, paste the whole of
   `supabase/migrations/024_kombat_rooms.sql`, and Run. It does not depend on
   023.
2. Nothing to change in Realtime settings. Private channels need no switch,
   and **"Allow public access" must stay on**, because the chat page uses
   public Postgres-changes channels.
3. No new keys, secrets or CSP entries: the page uses the publishable key and
   the Supabase library the member pages already load, and `netlify.toml`
   already allows `cdn.jsdelivr.net` and the project over https and wss.

Until step 1 is done, "Play with a friend" says online play isn't switched on
yet. Arcade and Same keyboard work either way.

## Checks after setup

On the deploy preview or the live site, with two devices (or two different
browsers):

- Device A: Games > Hospital Kombat > Play with a friend. Copy the link (or
  Share… on a phone) and open it on device B. B lands in A's lobby.
- Both pick fighters and press Ready. Play a round on a phone in landscape.
- Rematch from the result screen; then close B's tab mid-match and check that A
  is told the friend dropped.
- Open the same link on a third device: it says the game already has two
  players. Wait 15 minutes with an unused link: it says the link has expired.

To see rooms (as an admin, in the SQL Editor):

```sql
select id, created_at, invite_expires_at, expires_at, closed_at, guest_hash is not null as guest_seated
from public.kombat_rooms order by created_at desc limit 20;
```

## Limits to watch

Supabase's free plan allows about 100 Realtime messages a second for the whole
project. A match uses about 25 (20 state updates, a few button-press updates),
so roughly four matches can run at once on the free plan before Realtime
starts dropping messages. If online play becomes popular, the Pro plan raises
the limit, or `STATE_EVERY` in the game (host updates per tick) can be raised
to send fewer updates.

## Turning it off

To switch online play off without a site change, run:

```sql
revoke execute on function public.kombat_create_room() from anon, authenticated;
```

New games can't be made (the button then reports a problem reaching the game
server); games already running finish normally. Grant it back to switch on
again.

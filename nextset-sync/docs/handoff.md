# Handoff: NextSet Sync (Claude ↔ ChatGPT/Codex)

The shared status board for the AI agents working on this project and for the
owner. Read [../AGENTS.md](../AGENTS.md) for the rules. **Update the log at
the bottom whenever you finish a piece of work.**

## Goal

**Standalone:** watch data travels watch → Bluetooth → this app's own storage.
No Apple Health (HealthKit removed at the owner's request), no account, no server.

Two apps that make a Bangle.js 2 a dependable strength-training and sleep
companion for the owner's iPhone, with no vendor app and no cloud:

* **Watch:** run a workout sent from the phone; log load, reps and RIR fast
  with sweaty hands; vibrate when rest is over; never lose a set.
* **Phone:** send workouts, receive sets exactly once, show history, export
  CSV, and show sleep from Sleep Log, all inside the app.
* Later: feed NextSet (Expo app, `DrZaff/nextset-strength`); see
  [nextset-integration.md](nextset-integration.md).

The owner has **no Mac**: builds run on GitHub Actions macOS runners and
installs go through TestFlight ([no-mac-setup.md](no-mac-setup.md)).

## State on 2026-11-13

| Area | Status | Evidence |
|---|---|---|
| Watch app (`watch/nsync`) | Done, v0.01 | 46/46 checks in the real Espruino 2v29 interpreter; BangleApps sanity check clean |
| Protocol v1 | Done | [protocol.md](protocol.md); shared vectors; Swift engine tested against the real watch code (bridge test) |
| Swift core | Done | 39 tests on Linux and macOS (GitHub) |
| iOS app | **Compiles** with Xcode 26.3 for simulator and device (GitHub macOS runner, `BUILD SUCCEEDED`); never run on a phone | CI run 43484568933 |
| TestFlight pipeline | Written, **not yet run** (needs the owner's Apple setup and a separate repo) | `.github/workflows/testflight.yml` |
| Hardware | Watch arriving next week. Nothing tested on a real Bangle or iPhone yet | first-day-checklist.md |

Facts verified against upstream source (don't re-derive; cite if you change
them): Bootloader service merging, the `setServices` restart deferral, MTU 131,
`Storage.write` erasing before writing, Sleep Log 0.26's format and quirks, and
the App Loader's "Install App from Files" deleting declared data. See the README's
"Versions pinned" table and [sleep-log.md](sleep-log.md).

## Who does what

Full proposal, with each side's strengths and weaknesses:
[collaboration.md](collaboration.md) (awaiting ChatGPT's assessment via
[chatgpt-brief.md](chatgpt-brief.md)). In short: **one agent builds, the other
reviews the exact commit, the owner merges.**

| Owner | Claude (Claude Code) | ChatGPT / Codex |
|---|---|---|
| Apple setup, secrets, TestFlight installs, hardware tests, merging | Protocol, watch firmware-level code, CI and TestFlight pipeline, hardware bug triage | Independent review of every PR; the iOS UX and feature items below marked **Codex**; UI tests |

How to hand work over:
1. Work on a branch: `claude/<topic>` or `codex/<topic>`. One topic per PR.
2. The PR description says what changed, how it was verified (paste the CI
   link), and what still needs hardware.
3. The other agent reviews **the commit SHA**, not the branch tip:
   protocol compatibility, never-lose-a-set, Espruino JS limits, iOS API use.
   Findings go as PR review comments.
4. The owner merges once CI is green and the review is resolved.
5. Append a line to the log below.

## Work queue (in order)

### P0: get it on the phone
1. **Owner:** create the `DrZaff/nextset-sync` repo and the Apple setup
   (no-mac-setup.md steps 1–4). **Claude** pushes the folder there.
2. **Claude:** first TestFlight run, fixing whatever signing or upload
   issue appears (watch the logs; common ones: API key role, bundle ID,
   missing App Store Connect record).
3. **Owner:** first-day hardware test (first-day-checklist.md); file each
   problem as a GitHub issue with what was tapped and what happened.

### Design
* **Icon (ChatGPT first):** the owner wants a 16-bit game-logo look in 90s
  colours. Claude's draft is in `design/icon-16bit/` (editable `icon.txt`
  grid + `render.py`), not yet wired into the app. ChatGPT critiques and
  improves it ([chatgpt-brief.md](chatgpt-brief.md)); the owner picks; then
  copy `icon-1024.png` into `ios/NextSetSync/Assets.xcassets/AppIcon.appiconset/`
  and make a matching 48×48 watch icon.

### Next (in order; see docs/features.md for the why)
* **Owner:** first hardware test with `first-day-checklist.md` (rows A–L), and
  the text-preview coexistence check.
* **Claude:** heart-rate and recovery slice, from BangleApps Health 0.44 (format
  verified in `health-log.md`) with a `chk` check-in record kind; then
  readiness into NextSet's `readiness` input.
* **Codex:** local backup and restore ("time capsule", features.md #1), then
  "gym-floor polish" (tempo metronome, plate calculator and warm-up ramp,
  RIR-aware rest: #2–4) as one PR; XCUITest smoke in CI.
* Later: retro watch face, GPS walks via Recorder, slide remote (needs its own
  feasibility test: one BLE connection at a time).

### P1: make it great (pick up anytime; independent of each other)
4. **Codex:** XCUITest smoke test in CI on the iOS simulator, in demo mode:
   launch → Watch tab → Sync Now → History shows sets → Sleep tab shows a
   chart. Needs accessibility identifiers on the key controls. Run it in the
   `ios` CI job (`xcodebuild test -scheme NextSetSync -destination 'platform=iOS Simulator,OS=latest,name=iPhone 16'`;
   check the runner's simulator list first).
5. **Codex:** screenshots of every watch screen from the official Bangle.js 2
   emulator (EspruinoWebTools / BangleApps `bin/runapptests.js` use one), saved
   as CI artifacts, so the 176×176 layout can be reviewed without a watch.
6. **Claude:** rest timer that still buzzes after leaving the app (`sched`
   library timer, as an optional dependency), and showing "last time: 135×8"
   on the set screen (data already in `nsync.last.json`).
7. **Codex:** History upgrades: per-exercise progression chart (estimated
   1RM, same formula as NextSet's `estimate1RM` in `src/core.mjs`), and
   sessions grouped by week.
8. **Claude:** timed exercises (planks): a duration field on the watch,
   `duration_seconds` in the record (additive protocol field), mapped to
   NextSet's column.
9. **Either:** accessibility pass (Dynamic Type, VoiceOver labels), app icon
    variants (dark/tinted), localisation-ready strings.

### P2: NextSet
11. Expo native module wrapping `NextSetSyncCore` (option 2 in
    nextset-integration.md), so NextSet sends prescriptions and receives sets
    directly. Coordinate with the owner first: it changes the NextSet repo.

## Known risks and open questions

* The Bluetooth stack on a real Bangle under load: notification pacing
  (`tx` retries every 40 ms) has only been exercised with mocks.
* Sleep estimates are Sleep Log's movement heuristics, not clinical; the UI
  says so, so keep it that way.
* iOS background reconnection relies on state restoration; it does not
  survive a force-quit (an Apple rule). Documented to the owner.
* The `testflight` workflow uses Xcode cloud signing with an **Admin** API
  key. If the owner prefers a narrower key, switch to manual signing with an
  exported distribution certificate and profile stored as secrets.

## Kickoff prompt for Codex / ChatGPT

Paste this into Codex (connected to the `DrZaff/nextset-sync` repository, or
until it exists, `DrZaff/ai-medicine-collective` branch
`claude/bangle-iphone-workout-sleep-x9j8xy`, folder `nextset-sync/`):

> You are joining an existing project as a collaborator with Claude. Read
> `AGENTS.md` and `docs/handoff.md` first, then `docs/protocol.md`.
> 1. **Review first.** Review the latest commit independently: look for
>    data-loss paths in sync (the watch must never lose a set; the phone must
>    never show a set twice), protocol mismatches between `watch/nsync/lib.js`
>    and `ios/NextSetSyncCore/Sources/NextSetSyncCore/sync.swift`, Espruino
>    JavaScript that would not run on firmware 2v29, and iOS 17 API misuse in
>    `ios/NextSetSync/`. Report findings with file:line and a concrete fix;
>    do not rewrite working code for style.
> 2. **Then take one P1 item marked Codex** in `docs/handoff.md` (start with
>    #4, the XCUITest smoke test), on a branch `codex/<topic>`, in a small PR
>    whose description lists what you verified and the CI run link.
> 3. Run `scripts/run-tests.sh` (or rely on CI if you have no Swift). Never
>    claim a test or build passed unless you saw it pass.
> 4. Append a line to the log in `docs/handoff.md`.

## Log

| Date | Who | What |
|---|---|---|
| 2026-11-13 | Claude | Built both apps, protocol v1, tests, docs (commit 3398215) |
| 2026-11-13 | Claude | GitHub CI: iOS app compiles on Xcode 26.3 (sim + device), all tests green on macOS and Linux; added the no-Mac/TestFlight path, app icon, Transferable sharing, Swift 6-clean demo wiring, AGENTS.md and this handoff |
| 2026-11-13 | Claude | 16-bit icon draft (design/icon-16bit), collaboration proposal and ChatGPT brief |
| 2026-11-13 | Claude | Removed Apple Health entirely (code, entitlement, permissions, docs) at the owner's request |
| 2026-11-13 | Codex | First daily-use slice: Workout Ghost, silent timers and stopwatch, watch-local markers, retro status screen, and iPhone Today with training and sleep. Review and device validation pending. |
| 2026-11-13 | Codex | PR #182: Workout Ghost, watch tools, Today (merged at the owner's direction after Claude's review) |
| 2026-11-13 | Claude | Fixed the review findings (timers via Scheduler, unlock guard, crash-safe markers with ids, last-set memory, Ghost legibility, Today demo bug); kinds negotiation + ack-only-stored (fixes silent loss of new record kinds); marker sync end to end; Moments with phone-only notes; diagnostics; watch-files CI artifact; features.md, health-log.md. Watch 74 checks, Swift 41 tests. |

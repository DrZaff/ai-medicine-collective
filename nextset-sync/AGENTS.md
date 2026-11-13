# AGENTS.md: NextSet Sync

Instructions for AI coding agents (Codex, ChatGPT, Claude Code) working on this
project. Read [docs/handoff.md](docs/handoff.md) first: what exists, what is
verified, what is open and who is doing what.

## The project in one paragraph

A Bangle.js 2 watch app (`watch/nsync/`, Espruino JavaScript) and a SwiftUI
iPhone app (`ios/`) that sync workouts, logged sets and Sleep Log data over a
direct Bluetooth LE link (protocol v1, [docs/protocol.md](docs/protocol.md)),
storing everything locally. The owner has **no Mac**: all iOS builds run on
GitHub Actions macOS runners, and installs go through TestFlight
([docs/no-mac-setup.md](docs/no-mac-setup.md)).

## Rules

1. **Tests pass before you push**, and CI must be green:
   `scripts/run-tests.sh` runs the watch code in the real Espruino 2v29
   interpreter plus every Swift test. If you cannot run Swift locally, push to
   a branch and read CI; never claim a build or test passed unless you saw it.
2. **The protocol is a contract between two codebases.** Any change to
   message types, fields, framing or record identity must update `lib.js`,
   `wire.swift`/`sync.swift`, `simulated-watch.swift`, `docs/protocol.md` and
   the tests in the same change. Additive fields are fine in v1; anything
   incompatible bumps `SyncProtocol.version` and the watch's `PROTO`, and keeps
   v1 working until both apps are updated.
3. **Never lose a set.** Records leave the watch only after the phone's
   durable write plus an ack. Keep `pend`/`ses` in the two-slot files
   (`writeDual`). Do not add these files to `metadata.json` `data` (see the
   watch README for why).
4. **Watch JavaScript runs on Espruino, not Node.** Stay with ES5-style code
   plus arrow functions, `let`/`const`, template-free string concatenation.
   No `{n}` regex quantifiers (unsupported), no optional chaining, no
   destructuring, no `async`. Boot code runs in every app, so keep `boot.js`
   tiny and put logic in `lib.js` (loaded on demand). 176×176 screen, one
   button, touch targets of at least about 56 px.
5. **No patient information, no real personal data** in fixtures, tests,
   screenshots or docs. Everything synthetic.
6. **No secrets in the repo.** Signing material lives only in the GitHub
   `testflight` environment.
7. **Sleep Log is pinned at 0.26.** Read it only through
   `require("sleeplog").readLog`. If you change the analysis, update
   `protocol/fixtures/make-sleep-fixture.py` and `sleep-expected.json`
   deliberately and say why.
8. **Swift:** iOS 17+, Swift 5 language mode. `NextSetSyncCore` must stay
   free of UIKit, SwiftUI, Core Bluetooth and HealthKit so it builds and tests
   on Linux. Platform code goes in `ios/NextSetSync/`. New files in that
   folder are picked up automatically (synchronized group); do not hand-edit
   `project.pbxproj`, regenerate it with `scripts/make-xcodeproj.py`.
9. Small, reviewable pull requests. Say in the description what you
   verified, and what still needs hardware.

## Commands

```sh
scripts/run-tests.sh                                   # everything (Linux or macOS; Node 22, Swift 5.9+)
ESPRUINO=/path/to/espruino node watch/test/run.mjs     # watch only
cd ios/NextSetSyncCore && swift test                   # Swift only (bridge test skipped without NSYNC_ESPRUINO)
python3 scripts/make-xcodeproj.py                      # regenerate the Xcode project
```

Without Swift locally: the official `swift:6.2` Docker image, or
https://www.swift.org/install/ (swiftly), or rely on CI.

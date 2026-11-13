# NextSet Sync: Bangle.js 2 ↔ iPhone, direct Bluetooth

A SwiftUI iPhone app and a Bangle.js 2 watch app that sync over a direct Bluetooth LE link, with local storage only. No Gadgetbridge, no vendor companion app, no account, no cloud.

* **Workouts:** choose or create a workout on the iPhone and send it to the watch. On the watch you see the exercise and prescribed set, set load, reps and RIR with large touch targets, and LOG starts a rest timer that vibrates at zero. The session continues with the phone gone and survives app exits and reboots. Sets come back to the iPhone exactly once, with per-set sync status, history and CSV export.
* **Sleep:** the watch serves Sleep Log 0.26's own log over the same link, so nothing stays open overnight. The iPhone shows estimated sleep, sleep and wake times and a seven-night trend, handling nights across midnight, partial nights, time-zone changes and repeated imports. Sleep Log's light/deep estimates are labelled as estimates.
* **Everyday tools:** Workout Ghost (last time's set, with a buzz when you match or beat it), silent talk/focus/stretch timers and a stopwatch that keep going if you leave the app, and moment markers ("Coffee", "Idea") that sync to the iPhone's Today screen, where you can add notes kept only on the phone.
* **Standalone:** watch data goes watch → Bluetooth → this app's own storage. No Apple Health, no account, no cloud.
* **Demo mode** gives a simulated watch with realistic sets and nine nights of sleep, so every screen works before the watch arrives.

**No Mac needed.** GitHub's macOS machines build the iPhone app, and TestFlight installs it ([docs/no-mac-setup.md](docs/no-mac-setup.md)). The watch app installs from Chrome or Edge on Windows.

**Start here: [docs/first-day-checklist.md](docs/first-day-checklist.md).** For AI collaborators (Codex, ChatGPT, Claude): [AGENTS.md](AGENTS.md) and [docs/handoff.md](docs/handoff.md).

> This folder lives on the branch `claude/bangle-iphone-workout-sleep-x9j8xy` of the AI Medicine Collective website repository, because that was the repository this session could write to. **Do not merge it into the website's `main`:** Netlify publishes that repository's root. Move it to its own repository, or into NextSet, when convenient. Nothing in it depends on its location.

## Why standalone

`DrZaff/nextset-strength` is an Expo / React Native app with no SwiftUI target, so there was nothing Swift to extend. This app reuses NextSet's workout and set field names. It imports NextSet plans and prescriptions directly (tested with output from NextSet's own `generatePlan()`), and its CSV starts with NextSet's 13 columns. See [docs/nextset-integration.md](docs/nextset-integration.md).

## Layout

| Path | What |
|---|---|
| `watch/nsync/` | The Bangle.js 2 app as a BangleApps folder: `metadata.json`, `app.js` (UI), `boot.js` (Bluetooth service), `lib.js` (protocol, storage) |
| `ios/nextset-sync.xcodeproj` | Xcode project, scheme **NextSetSync** (iOS 17+) |
| `ios/NextSetSync/` | SwiftUI app: Core Bluetooth (`bluetooth.swift`), screens |
| `ios/NextSetSyncCore/` | Swift package with no UI: models, protocol, sync engine, storage, Sleep Log parser and analysis, CSV, imports, simulated watch, tests |
| `protocol/` | Shared test vectors and fixtures (synthetic Sleep Log nights, NextSet JSON) |
| `docs/` | [protocol](docs/protocol.md), [Sleep Log](docs/sleep-log.md), [NextSet integration](docs/nextset-integration.md), [first-day checklist](docs/first-day-checklist.md) |
| `scripts/` | `run-tests.sh`, `build-espruino.sh`, `make-xcodeproj.py` |
| `.github/workflows/` | `ci.yml` (build + all tests on macOS and Linux), `testflight.yml` (sign and upload); active once this folder is its own repository |

## Versions pinned and verified against source

| Component | Version | Checked |
|---|---|---|
| Bangle.js 2 firmware | **2v29** (`RELEASE_2V29`) | MTU 131 (`boards/BANGLEJS2.py`); 10 vendor UUIDs, `writable` = write + write without response, `setServices` restart deferred while connected (`targets/nrf5x/bluetooth.c`, `jswrap_bluetooth.c`); `Storage.write` erases the old copy before writing the new one (`jsflash.c`), hence the two-slot files |
| Bootloader | 0.70 | `.boot0` collects `bleServices` from every `*.boot.js` and calls `NRF.setServices` once (since 0.34); it rebuilds itself when any `.js` file changes |
| Sleep Log | **0.26** | storage format and `readLog` semantics, see [docs/sleep-log.md](docs/sleep-log.md) |
| App Loader | BangleApps `1c5bb82`, core `f75f0bd` | Update keeps declared data files; *Install App from Files* erases them on reinstall, so this app's critical files are left undeclared |
| iOS | 17.0+ | `connect` never times out (Apple docs); state restoration for background reconnection |

**Watch app dependencies:** Bootloader ≥ 0.34 (default), firmware 2v29, and Sleep Log 0.26 for sleep (optional: workouts work without it). It coexists with Sleep Log and with iOS Integration (ANCS), whose service options are merged by the bootloader, not overwritten.

## Test results (2026-11-13)

| Suite | Result |
|---|---|
| Watch code (`app.js`, `boot.js`, `lib.js`) in the **real Espruino 2v29 interpreter** (Linux build), Bluetooth and screen mocked: `node watch/test/run.mjs` | **74 / 74 passed** (watch 0.02): boot registration without `setServices`; pairing, wrong key and replay refused; workout stored before ack despite a busy radio; sets logged offline; app killed mid-rest and resumed; edits keep id and bump rev; paged pull; a frame cut off by a disconnect is discarded; repeated and stale acks; corrupted frame; Sleep Log read through its own `readLog` across archive and current log; time-zone setting saved; torn write of the pending list recovered |
| Swift core, `swift test` (Swift 6.2.4, Linux) | **41 / 41 passed** (incl. markers, unknown-kind safety): shared vectors (SHA-256, framing); chunk reassembly at 1–1000 bytes; Sleep Log parsing; all 8 fixture nights (midnight, after midnight, New York→Denver, nap, moveLog gap, partial); trend; repeated and out-of-order imports idempotent; asleep intervals split at awake spells; store upsert rules; CSV with formula injection blocked; NextSet plan and prescription import; text import; and engine ↔ simulated watch: offline set exactly once, response truncated mid-pull, ack lost, duplicated notification, edit after sync, 30-set paging, sleep repeat import, no Sleep Log, restart with pending state, wrong watch, timeout |
| **Swift engine ↔ real watch code** (`EspruinoBridgeTests`, through `watch/test/bridge.mjs`) | **passed**: pair, send workout, disconnect, log on the watch, reconnect: exactly one set; Sleep Log's eight nights match the fixture; finished session |
| BangleApps `bin/sanitycheck.js` with `apps/nsync` added | **0 errors, 0 warnings** for this app |
| iOS app target (SwiftUI, Core Bluetooth) on a GitHub macOS runner, **Xcode 26.3** | **`BUILD SUCCEEDED`** for iOS Simulator and for iPhone (unsigned Release); the Swift tests also pass on macOS. The first CI run's only two warnings (Swift 6 capture in demo mode) are fixed. Earlier, an independent review found one compile error and five runtime issues, all fixed. |
| Same tests on GitHub's Linux runner | 46/46 watch, 39/39 Swift |

**Pending until tested on hardware:** physical Bluetooth pairing, overnight logging, haptics, background reconnection, and the first signed TestFlight upload (needs your Apple setup). The app lists them under **Settings → Not yet tested on real hardware**.

Run everything that doesn't need hardware with `scripts/run-tests.sh` (Linux or macOS; needs Node 22 and Swift 5.9+).

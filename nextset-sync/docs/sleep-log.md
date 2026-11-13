# Sleep Log: supported version, storage format, settings

**Supported:** Sleep Log **0.26** (BangleApps `apps/sleeplog`, inspected at
commit `1c5bb82de7aaf4f9f5508847681d8f055d9a2ded`, 2026-11-13; `lib.js`
SHA-256 `80053aa2…24ce0`). A verbatim copy of its `lib.js` is in
`watch/test/vendor/` and the watch tests run against it.

## What Sleep Log stores (verified in its source)

| File | Written by | Format |
|---|---|---|
| `sleeplog.log` (StorageFile) | `boot.js` `appendStatus` | one line per change: `t10,status,consecutive` |
| same file, lines starting with `,` | `boot.js` `saveStatus` | saved service state (`,lastCheck,awakeSince,asleepSince[,debug…]`), not transitions |
| `sleeplog_NNNN.log` | `lib.js` `moveLog` (every 14 days) | JSON array `[[t10,status,consecutive],…]`; NNNN = fortnights since 1970-01-04 12:00 UTC |
| `sleeplog.json` | settings app | thresholds, `enabled`, `sleepMode` (0 movement, 1 HRM, 2 both) |

* **Timestamps:** `t10 = floor(UTC milliseconds / 600 000)`: 10-minute steps
  since 1970-01-01 **UTC**. They do not depend on the watch's time zone, so a
  zone change never shifts stored data. The watch clock must be right; the
  iPhone sets it (and the zone) on every connection.
* **Status:** 0 unknown, 1 not worn, 2 awake, 3 light sleep, 4 deep sleep.
  Decided every 10 minutes from the firmware's `health` event (movement, or
  HRM depending on `sleepMode`); charging means "not worn".
* **Consecutive:** 0 unknown (decided later), 1 not consecutive, 2 consecutive
  sleep. Consecutive sleep starts after `minConsec` (30 min) of deep sleep and
  ends after `maxAwake` (60 min) awake. `readLog` fills a 0 from the next known
  entry, and so does this app.
* A line is written only when status or consecutive changes, so a value lasts
  until the next line.

## How this app reads it

The watch's boot code answers the phone with
`require("sleeplog").readLog(since, now)`, Sleep Log's own reader, which
merges the archive files and the current log. Sleep Log keeps recording in the
background from its own boot code, so nothing has to stay open overnight, and
this app never writes Sleep Log's files.

Two quirks found in the source and handled:

1. **Leading copy.** `readLog` starts its answer with the state in force at
   `since`, re-stamped `since`. The phone drops it unless that time is a stored
   transition, so repeated imports add nothing.
2. **The moveLog gap.** When Sleep Log starts its fortnightly archive (on the
   first consecutive sleep of a new fortnight, so mid-night), `moveLog` rewrites
   the log through `readLog(…, end of fortnight)`, which appends an "unknown"
   entry at that moment. The real state is only written at the next change.
   The phone counts an unknown stretch of up to 4 hours that lies between two
   consecutive-sleep entries as asleep, and labels it ("includes N min where
   Sleep Log recorded unknown"). Unknown stretches anywhere else end the
   episode (for example when the watch was off).

## How nights are estimated (iPhone)

* **Asleep** = light + deep minutes (plus bridged minutes above).
* An **episode** starts at the first light or deep entry. Awake spells of
  60 minutes or less followed by sleep stay inside it (counted as "awake in
  between", not asleep). It ends at a longer awake spell, "not worn", or an
  unknown stretch. Episodes under 20 minutes asleep are ignored.
* **Night = wake date**: episodes are grouped by the local date they end, in
  the time zone the iPhone was in at that moment (the app records a zone
  history at launch and every sync). The longest episode is the night; the
  others are naps. So a night from 23:10 to 06:40 belongs to the morning it
  ended, and falling asleep at 00:30 belongs to the same morning.
* **Partial**: if the data ends while asleep (the night is still going, or
  the watch stopped logging), the night is marked and shown in orange; it is
  not exported to Apple Health until it ends. If the data begins mid-sleep,
  the night says the real bedtime may be earlier.
* **Seven-night trend**: the seven wake dates ending today, gaps left empty.
* **Stages**: light and deep are shown as "Sleep Log estimate". They are
  movement thresholds, not clinical stages, and are not written to Apple Health.

## Apple Health

Optional, after permission. Each finished episode's asleep stretches (split
at awake spells) are written as `HKCategoryValueSleepAnalysis.asleepUnspecified`
(iOS 16+) with `HKMetadataKeySyncIdentifier` `nsync.sleep.<watch id>.<t10>`,
`HKMetadataKeySyncVersion`, `HKMetadataKeyTimeZone`, and an `HKDevice`
naming the Bangle.js 2 and Sleep Log version. HealthKit replaces a sample
when the same identifier arrives with a higher version, so a stretch that
changed is re-written once and nothing is duplicated.

## Settings to check on the watch

* **Sleep Log** installed and **enabled** (Settings → Apps → Sleep Log →
  Enabled; default on).
* **Health → HRM** polling is optional. Leave **Sleep Mode** on Movement
  (the default) unless you have tuned the HRM thresholds.
* Wear the watch snugly and not on the charger overnight (charging = not worn).
* Keep the watch's time right: the iPhone sets it on every connection.

## If Sleep Log changes

The format above is pinned to 0.26. The phone reads it only through Sleep
Log's own `readLog`, so internal file changes that keep `readLog`'s
`[t10, status, consecutive]` output keep working. If a future version changes
those meanings, update `SleepLogParser`/`SleepAnalyzer`, the fixture
(`protocol/fixtures/make-sleep-fixture.py`) and the vendored copy, then rerun
the tests.

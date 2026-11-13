# BangleApps Health log: research for the heart-rate and recovery slice

Prepared ahead of the hardware slice so it can start immediately. Verified
from source: BangleApps `apps/health`, **version 0.44**, commit `1c5bb82`.

## What it records

* Monthly files `health-YYYY-M.raw` (month not zero-padded, e.g.
  `health-2026-11.raw`), written by its boot code from the firmware's
  `health` event, every 10 minutes.
* Header `HEALTH2` (7 bytes plus 1) and then fixed records: 6 per hour plus 1
  daily summary per day (`DB_RECORDS_PER_DAY = 145`), each 10 bytes:

| Bytes | Field |
|---|---|
| 0–1 | steps (uint16, big-endian) |
| 2 / 3 | bpm min / bpm max (0 = no reading) |
| 4 | movement / 8 |
| 5 | battery %, top bit = charging |
| 6 | temperature in 0.5 °C steps |
| 7–8 | altitude (13 bits, signed past 7500) + activity in the top 3 bits of byte 7: UNKNOWN, NOT_WORN, WALKING, EXERCISE, LIGHT_SLEEP, DEEP_SLEEP |

* Unused slots are `0xFF` bytes. Older files may be `HEALTH1` (4-byte
  records: steps, bpm, movement); `getDecoder` handles both.
* Read API (module `health`): `readAllRecordsSince(date, cb)`,
  `readDay(date, cb)`, `readDailySummaries(date, cb)`, `readFullDatabase(cb)`.
* Heart rate is recorded only if HRM polling is on: Health app settings,
  *HRM interval* 3 or 10 minutes (it checks the watch is worn first).

## Pitfall: time zones

Records are indexed by **local** time (the file name and the slot come from
`new Date()`), unless the 0.44 setting "store in UTC" is on. Travelling
across zones shifts slots and can overwrite or skip an hour. **Recommend:**
turn on the UTC setting, and have the watch report which mode is in use, so
the phone can convert correctly.

## Proposed approach (same pattern as Sleep Log)

1. The watch reads through the Health app's own module, never its file
   layout, and pages records since a cursor: a `health` request, the same
   shape as `sleep`.
2. The phone stores 10-minute rows keyed by (UTC slot time), so repeat
   imports are idempotent; shows missing data as missing.
3. Resting heart rate = the lowest 30-minute rolling mean of `bpm` during
   the main sleep episode (from Sleep Log), compared to a 7-day median.
4. Check-ins are a new record kind `chk` (`{score 1-5, at}`) through the
   kinds negotiation, so they sync exactly once.
5. Pin Health 0.44 like Sleep Log 0.26, with a vendored copy of its
   `lib.js` and a fixture month file in the tests.

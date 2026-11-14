#!/usr/bin/env python3
"""Generate a synthetic BangleApps Health (0.44) month file for the tests.

Writes, next to this script:
  health-2026-11.raw     the HEALTH2 file exactly as the Health app stores it:
                         "HEALTH2\\0" then 31 days x (144 ten-minute records + 1
                         daily summary) x 10 bytes; unused slots are 0xFF.
                         Slots here are UTC wall-clock (the tests run the watch
                         with time zone 0, so local == UTC).
  health-expected.json   resting heart rate per wake date, for the phone tests.

Heart rate during each fixture night (the same nights as sleeplog-sample.log)
sits at R+5..R+9 bpm, with exactly one 30-minute window (3 slots) at R, so the
lowest 30-minute mean inside the sleep episode is R. Days have steps and
70-95 bpm. All synthetic.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).parent
NY, DEN = timezone(timedelta(hours=-5)), timezone(timedelta(hours=-7))
# (evening day, zone, sleep start, wake) - "HH:MM", HH >= 24 = next morning
NIGHTS = [(5, NY, "23:10", "30:40"), (6, NY, "23:40", "31:10"), (7, NY, "24:30", "32:00"),
          (8, NY, "23:10", "30:30"), (9, DEN, "23:00", "30:30"), (10, DEN, "22:50", "30:20"),
          (11, DEN, "23:10", "29:50"), (12, NY, "23:30", "29:40")]
WAKE = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]
RESTING = [52, 53, 51, 55, 58, 54, 52, 50]
ACT = ["UNKNOWN", "NOT_WORN", "WALKING", "EXERCISE", "LIGHT_SLEEP", "DEEP_SLEEP"]
LAST_SLOT = datetime(2026, 11, 13, 10, 40, tzinfo=timezone.utc)  # data ends with the last sleep night


def at(day, tz, hhmm):
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 11, day, 0, 0, tzinfo=tz) + timedelta(hours=h, minutes=m)


def record(steps, bmin, bmax, movement, battery, temp, alt, act):
    a = alt & 8191
    return bytes([steps >> 8, steps & 255, bmin, bmax, min(movement >> 3, 255), battery, int(temp * 2),
                  (a >> 8) | (ACT.index(act) << 5), a & 255, 0xFF])


slots = {}
t = datetime(2026, 11, 1, tzinfo=timezone.utc)
while t <= LAST_SLOT:
    h = t.hour
    slots[t] = record(steps=0 if h < 7 or h > 22 else 40 + (h * 37 + t.minute) % 160, bmin=72 + h % 7, bmax=88 + h % 8,
                      movement=300 + h * 10, battery=80, temp=31.5, alt=120, act="WALKING" if 7 <= h <= 22 else "UNKNOWN")
    t += timedelta(minutes=10)

for (day, tz, s, e), r in zip(NIGHTS, RESTING):
    start, end = at(day, tz, s).astimezone(timezone.utc), at(day, tz, e).astimezone(timezone.utc)
    mid = start + (end - start) / 2
    mid = mid.replace(minute=mid.minute - mid.minute % 10, second=0, microsecond=0)
    t = start
    while t < end:
        if t in slots:
            low = mid <= t < mid + timedelta(minutes=30)
            bpm = r if low else r + 5 + (t.minute // 10) % 5
            slots[t] = record(steps=0, bmin=bpm, bmax=bpm, movement=40, battery=80, temp=33.0, alt=120, act="LIGHT_SLEEP")
        t += timedelta(minutes=10)

data = bytearray(b"HEALTH2\x00")
for day in range(31):
    for hr in range(24):
        for m in range(6):
            t = datetime(2026, 11, day + 1, hr, m * 10, tzinfo=timezone.utc) if day < 30 else None  # November has 30 days
            data += slots.get(t, b"\xff" * 10)
    data += b"\xff" * 10  # daily summary (unused here)
(HERE / "health-2026-11.raw").write_bytes(bytes(data))
(HERE / "health-expected.json").write_text(json.dumps({
    "file": "health-2026-11.raw", "lastSlotT10": int(LAST_SLOT.timestamp()) // 600,
    "resting": dict(zip(WAKE, RESTING)),
    # 7-night median before the last night (2026-11-13): median of the first 7 values
    "baselineFor": {"2026-11-13": sorted(RESTING[:7])[3]},
}, indent=1))
print(len(data), "bytes;", len(slots), "records")

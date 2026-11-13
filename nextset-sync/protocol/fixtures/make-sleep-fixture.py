#!/usr/bin/env python3
"""Generate the shared Sleep Log fixtures (synthetic data, no real person).

Writes, next to this script:
  sleeplog-sample.log      the current StorageFile exactly as Sleep Log 0.26
                           writes it: "t10,status,consecutive" lines, where t10
                           is UTC milliseconds / 600000, plus the "," status-save
                           lines and a duplicate, which readers must skip/merge
  sleeplog-archive.json    one fortnight archive (sleeplog_NNNN.log), a JSON
                           array of [t10, status, consecutive]
  sleep-expected.json      what the iPhone analysis must produce

Status: 0 unknown, 1 not worn, 2 awake, 3 light, 4 deep.
Consecutive: 0 unknown, 1 not consecutive, 2 consecutive sleep.

Eight nights, Nov 5-13 2026: New York (UTC-5), then Denver (UTC-7) from
Nov 9 to Nov 12, a nap, the moveLog "unknown" blip on Nov 8-9, a charging
gap, a night that starts after midnight, and an unfinished last night.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

NY = timezone(timedelta(hours=-5))
DEN = timezone(timedelta(hours=-7))
HERE = Path(__file__).parent


def night(evening_day, tz, events):
    """events: ("HH:MM", status, consecutive); HH >= 24 means the next morning."""
    out = []
    for hhmm, s, c in events:
        h, m = map(int, hhmm.split(":"))
        d = datetime(2026, 11, evening_day, 0, 0, tzinfo=tz) + timedelta(hours=h, minutes=m)
        out.append([int(d.timestamp() * 1000) // 600000, s, c])
    return out


def add(hhmm, minutes):
    h, m = map(int, hhmm.split(":"))
    t = h * 60 + m + minutes
    return f"{t // 60:02d}:{t % 60:02d}"


def standard(day, tz, start, wake):
    """Typical night: deep sleep detected at start, consecutive 30 min later,
    light/deep cycles, a 20-minute awake spell at 03:00, wake, and 60 min of
    being awake ends consecutive sleep."""
    return night(day, tz, [
        ("22:30", 2, 1), (start, 4, 0), (add(start, 30), 4, 2),
        ("25:40", 3, 2), ("26:30", 4, 2), ("27:00", 2, 2), ("27:20", 3, 2),
        ("28:30", 4, 2), ("29:30", 3, 2), (wake, 2, 0), (add(wake, 60), 2, 1),
    ])


entries = []
# 1. Nov 5 -> 6, New York, 23:10 - 06:40
entries += standard(5, NY, "23:10", "30:40")
# 2. Nov 6 -> 7, charging 19:00-20:00 first, then 23:40 - 07:10
entries += night(6, NY, [("19:00", 1, 1), ("20:00", 2, 1)])
entries += standard(6, NY, "23:40", "31:10")
# 3. Nov 7 -> 8, falls asleep after midnight: 00:30 - 08:00
entries += night(7, NY, [
    ("23:00", 2, 1), ("24:30", 4, 0), ("25:00", 4, 2), ("26:40", 3, 2),
    ("28:00", 4, 2), ("30:10", 3, 2), ("32:00", 2, 0), ("33:00", 2, 1)])
# 4. Nov 8 -> 9, the moveLog blip: "unknown" at 23:50 until light sleep at 01:00
entries += night(8, NY, [
    ("22:40", 2, 1), ("23:10", 4, 0), ("23:40", 4, 2), ("23:50", 0, 0),
    ("25:00", 3, 2), ("26:20", 4, 2), ("29:00", 3, 2), ("30:30", 2, 0), ("31:30", 2, 1)])
# 5. Nov 9 -> 10, Denver after a flight: 23:00 - 06:30 MT
entries += standard(9, DEN, "23:00", "30:30")
# 6. Nov 10 -> 11, Denver 22:50 - 06:20, then a nap Nov 11 14:00 - 14:50 MT
entries += standard(10, DEN, "22:50", "30:20")
entries += night(11, DEN, [("14:00", 4, 0), ("14:30", 4, 2), ("14:50", 2, 0), ("15:50", 2, 1)])
# 7. Nov 11 -> 12, Denver 23:10 - 05:50
entries += standard(11, DEN, "23:10", "29:50")
# 8. Nov 12 -> 13, New York again, still asleep when the data ends (05:30 deep)
entries += night(12, NY, [
    ("22:50", 2, 1), ("23:30", 4, 0), ("24:00", 4, 2), ("25:30", 3, 2),
    ("27:00", 4, 2), ("28:10", 3, 2), ("29:30", 4, 2)])

entries.sort(key=lambda e: e[0])
DATA_END = entries[-1][0] + 1  # Sleep Log's last check: 10 minutes after the last change

# Fortnight boundary used by Sleep Log: (n + 0.25) * 12096E5 ms.
ms_of_fn = lambda n: int((n + 0.25) * 1209600000)
fn_now = int(DATA_END * 600000 / 1209600000 - 0.25)
boundary = ms_of_fn(fn_now) // 600000
archive = [e for e in entries if e[0] < boundary]
current = [e for e in entries if e[0] >= boundary]

lines = [",".join(map(str, e)) for e in current]
# A status save line (",lastCheck,awakeSince,asleepSince") and a duplicate line,
# both of which Sleep Log really writes.
lines.insert(3, f",{current[2][0]},0,{current[1][0]}")
lines.insert(6, lines[5])
(HERE / "sleeplog-sample.log").write_text("\n".join(lines) + "\n")
(HERE / "sleeplog-archive.json").write_text(json.dumps(archive))
archive_name = f"sleeplog_{fn_now - 1:04d}.log"

expected = {
    "archiveFileName": archive_name,
    "dataEndT10": DATA_END,
    "zoneLog": [
        {"at": int(datetime(2026, 11, 1, 12, tzinfo=NY).timestamp()), "zone": "America/New_York"},
        {"at": int(datetime(2026, 11, 9, 18, tzinfo=DEN).timestamp()), "zone": "America/Denver"},
        {"at": int(datetime(2026, 11, 12, 18, tzinfo=NY).timestamp()), "zone": "America/New_York"},
    ],
    # wake date (local), sleep start/end local "HH:MM", asleep minutes, flags
    "nights": [
        {"wake": "2026-11-06", "start": "23:10", "end": "06:40", "asleep": 430, "partial": False},
        {"wake": "2026-11-07", "start": "23:40", "end": "07:10", "asleep": 430, "partial": False},
        {"wake": "2026-11-08", "start": "00:30", "end": "08:00", "asleep": 450, "partial": False},
        {"wake": "2026-11-09", "start": "23:10", "end": "06:30", "asleep": 440, "partial": False, "bridged": 70},
        {"wake": "2026-11-10", "start": "23:00", "end": "06:30", "asleep": 430, "partial": False},
        {"wake": "2026-11-11", "start": "22:50", "end": "06:20", "asleep": 430, "partial": False, "naps": 50},
        {"wake": "2026-11-12", "start": "23:10", "end": "05:50", "asleep": 380, "partial": False},
        {"wake": "2026-11-13", "start": "23:30", "end": "05:40", "asleep": 370, "partial": True},
    ],
}
(HERE / "sleep-expected.json").write_text(json.dumps(expected, indent=1))
print(f"{len(entries)} entries, archive {archive_name} has {len(archive)}, current file {len(current)}")

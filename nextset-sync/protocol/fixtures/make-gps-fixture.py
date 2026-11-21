#!/usr/bin/env python3
"""Synthetic GPS tracks for the Run / Walk tests (gps-tracks.json).

Every track is made up: a loop of radius 250 m around a made-up origin, run
or walked at a steady speed, with seeded noise. Each one exercises a case
from issue #198: steady pace and mile splits, a GPS gap, a stalled receiver
that repeats one fix, a pause while still moving, jitter while standing at a
split boundary, a single wild fix, and km units.

Compact rows, one per second like the Bangle's GPS:
  [t, x_dm, y_dm, fix, gps_s, hdop_x10]
t      seconds since the track starts (the watch's clock)
x, y   east / north of the origin in decimetres (the test converts to lat/lon)
fix    1 = position fix, 0 = none (the watch gets lat/lon NaN)
gps_s  the receiver's own UTC time for that fix, seconds since the track
       starts; a stalled receiver repeats the same value
hdop   horizontal dilution of precision x 10

`events` are [t, "start" | "pause" | "resume" | "finish"]. `expect` holds the
true numbers, from the path itself, that the watch's figures must match within
`tol` (a fraction) plus `slack_m` metres.

Run from the repository folder:  python3 protocol/fixtures/make-gps-fixture.py
"""
import json
import math
import os
import random

ORIGIN = (40.0, -100.0)  # made-up place
R = 250.0                # loop radius, metres
MILE, KM = 1609.344, 1000.0


def pos(s, noise, rnd):
    a = s / R
    return R * math.sin(a) + rnd.gauss(0, noise), R - R * math.cos(a) + rnd.gauss(0, noise)


def track(name, mode, units, buzz, seconds, speed, seed, noise=2.0, gap=None, stall=None, pause=None,
          stand=None, spike=None):
    rnd = random.Random(seed)
    rows, s, moving_dist, moving_s = [], 0.0, 0.0, 0
    events = [[0, "start"]]
    if pause:
        events += [[pause[0], "pause"], [pause[1], "resume"]]
    stalled_row = None
    for t in range(seconds + 1):
        standing = stand and stand[0] <= t < stand[1]
        paused = pause and pause[0] <= t < pause[1]
        if t > 0:
            step = 0.0 if standing else speed
            s += step
            if not paused:
                moving_dist += step
                moving_s += 1
        x, y = pos(s, noise * (2 if standing else 1), rnd)
        hdop = 9
        row = [t, round(x * 10), round(y * 10), 1, t, hdop]
        if gap and gap[0] <= t < gap[1]:
            row = [t, 0, 0, 0, t, 99]
        if stall and stall[0] <= t < stall[1]:
            if stalled_row is None:
                stalled_row = row[:]
            row = [t] + stalled_row[1:]  # same position, same receiver time
        if spike and t == spike:
            row[1] += 4000  # 400 m east for one fix
        rows.append(row)
    events.append([seconds, "finish"])
    splits = int(moving_dist // (MILE if units == "mi" else KM))
    return {
        "name": name, "mode": mode, "units": units, "buzz": buzz, "rows": rows, "events": events,
        "expect": {"dist_m": round(moving_dist, 1), "moving_s": moving_s, "elapsed_s": seconds, "splits": splits,
                   "pace_s": round((MILE if units == "mi" else KM) / speed) if speed else None},
        "tol": 0.03, "slack_m": 30 if stand else 0,
        "gap": gap, "stall": stall,
    }


def main():
    tracks = [
        track("run-steady", "run", "mi", True, 1000, 3.4, 1),
        track("run-gps-gap", "run", "mi", True, 700, 3.4, 2, gap=(300, 360)),
        track("run-stalled-fix", "run", "mi", True, 600, 3.4, 3, stall=(200, 230)),
        track("walk-pause-km", "walk", "km", False, 1500, 1.4, 4, pause=(600, 780)),
        # Reach the 1-mile point, stand there for two minutes with noisy fixes,
        # pause and resume while standing, then carry on.
        track("run-split-jitter", "run", "mi", True, 1000, 3.0, 5, stand=(537, 657), pause=(580, 600)),
        track("run-spike", "run", "mi", True, 400, 3.4, 6, spike=150),
        track("run-km", "run", "km", True, 700, 3.0, 7),
    ]
    out = {"origin": ORIGIN, "note": "Synthetic tracks; see make-gps-fixture.py", "tracks": tracks}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gps-tracks.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    for t in tracks:
        print("%-18s %4d rows  %7.1f m  splits %d  moving %d s" % (t["name"], len(t["rows"]), t["expect"]["dist_m"],
                                                                   t["expect"]["splits"], t["expect"]["moving_s"]))
    print("wrote", os.path.relpath(path), os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()

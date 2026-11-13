# Feature proposals (Claude, 2026-11-13)

Ideas that use what is unusual about this setup: a hackable watch, direct
Bluetooth, everything local, and NextSet's own training logic. Ranked by value
for effort. Every one keeps the rules in `AGENTS.md`: local only, no account,
no cloud, no Apple Health.

| # | Feature | Why it's different | Effort | Needs |
|---|---|---|---|---|
| 1 | **Local backup and restore ("time capsule")** | With no cloud, losing the phone means losing the history. One file in Files (or AirDrop to a computer) holding sets, sessions, markers, notes, sleep and workouts, and a restore that merges by record id, so restoring twice is harmless. | S | none |
| 2 | **Tempo metronome on the wrist** | NextSet prescribes tempo ("2-1-2"). During a set the watch gives a short buzz at each phase change, so you can keep the tempo without counting. Few watches can do this. | S | a tempo field on the watch (already in the workout) |
| 3 | **Plate calculator and warm-up ramp** | Swipe on the load box to see the plates per side for the bar and units. The first exercise offers NextSet's warm-up ramp (about 45 / 60 / 75 % of the working load, rounded to your plates). | S | none |
| 4 | **RIR-aware rest** | Rest after a set adapts to how hard it was: RIR 0–1 adds 30 s, RIR 4+ trims 15 s. That's NextSet's own guidance applied on the wrist, and shown as "Rest 2:30 (hard set)". | S | none |
| 5 | **Morning readiness that feeds NextSet** | Resting heart rate in the last hour of sleep (Health log, 10-minute records) against your 7-day baseline, plus a 1-tap "how do you feel" on the watch. The result sets NextSet's existing `readiness` input (`buildWorkoutPreview`), so today's prescription adapts: an easier first set, or one fewer set. | M | Health app log (see `health-log.md`), check-in record kind |
| 6 | **Workout Ghost, next level** | Compare set *N* with last session's set *N*, show a "+5 lb" or "+1 rep" target on the line, and give a distinct buzz for an all-time best at that weight. The retro face shows a pixel trophy that day. | S | per-set history on the watch |
| 7 | **Context insights from markers** | Local correlations on the phone: "sessions after a Coffee marker: +4 % volume", "Low energy marked on 3 of your last 5 short-sleep days". Plain counts, labelled as patterns, not advice. | M | marker sync (done), enough data |
| 8 | **Presentation pacing** | A talk timer that knows your slide count: a gentle buzz at each slide's time budget, two buzzes at 1 minute left, all silent. | S | timers (done) |
| 9 | **Retro watch face** | A 16-bit face showing steps, training days this week, the next timer, a PR trophy and "sets waiting". It only reads local files and redraws once a minute. | M | battery check over 24 h |
| 10 | **Wrist rep counter (experimental)** | Count reps from the accelerometer for curls, presses and rows; offer the count as the REPS default and never log it silently. A good research spike; accuracy has to be measured. | L | data collection, per-lift tuning |
| 11 | **Walk ghost** | For GPS walks (Recorder app), race your previous walk on the same route: "12 s ahead". | M | GPS slice, route matching |

**Recommended next three, after the first hardware test:** 1 (protects the
data), then 2 + 3 + 4 as one "gym-floor polish" PR (all watch-only and
small), then 5 (the most valuable "only we can do this" feature).

**Deliberately not proposed:** cloud sync, social sharing, or anything that
reads Apple Health. And no medical claims: readiness and calories are
labelled estimates.

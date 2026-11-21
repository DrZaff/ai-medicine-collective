# NextSet Sync (Bangle.js 2)

During a workout, swipe sideways on the load box or open **Plate calculator**
from the session menu. It assumes a 45 lb or 20 kg bar and standard paired
plates. The first exercise includes a 45%, 60%, and 75% warm-up ramp. Use
**Start tempo** in the session menu for an exercise with a tempo prescription.
End tempo when you finish the set, then log it. Automatic rest uses the RIR
you log: 0–1 adds 30 seconds and 4 or more subtracts 15 seconds.

Logs strength-training sets on the watch and syncs them, plus your Sleep Log
data, straight to the NextSet Sync iPhone app over Bluetooth LE. No
Gadgetbridge, vendor app or cloud account.

## Use

1. Open **NextSet Sync** on the watch, choose **Pair phone**, then tap **Pair
   Watch** in the iPhone app and confirm the code on the watch.
2. Send a workout from the iPhone, then choose **Start ...** on the watch.
3. On the set screen tap **LOAD**, **REPS** or **RIR** to select it, then use
   **-** / **+** (or drag up and down on the box). Tap **LOG** to save the set
   and start the rest timer. The watch vibrates when rest is over.
4. Press the button for the session menu: rest timer, edit or delete logged
   sets, extra set, next/previous exercise, finish workout.

Sets are saved on the watch the moment you log them and stay there until the
iPhone confirms it has stored them, so you can lift with the phone in your
locker. Closing the app keeps the session; open it again to resume.

## Tools (main menu)

* **Timers**: Chalk talk 5, Presentation 10, Focus 25, Stretch 2 minutes,
  silent. The button returns to the menu and the timer keeps running (the
  menu shows it at the top); **End** asks first; **+1 min** extends. The
  1-minute warning and the end buzz are Scheduler alarms, so they fire even
  if you leave the app.
* **Stopwatch** with laps; keeps counting if you leave the screen.
* **Mark a moment**: Coffee, Headache, Workout note, Idea, Felt great, Low
  energy. Timestamped, synced to the iPhone, where you can add a note.
* **Retro progress**: time, steps, sets waiting, running timer.
* **Sync** screen: what's waiting, last sync, Sleep Log and Scheduler
  status, free storage, versions (useful for bug reports).

Workout Ghost: the set screen's second line shows last time's set for the
exercise ("Last 135x8@2"); the first set that matches or beats it at the
same RIR gets a distinct buzz.

Needs the **Scheduler** app, which the App Loader installs as a dependency
of this app. Without it, timers buzz only while their screen is open.

## Run / Walk (outdoors, GPS)

**Run** or **Walk** in the main menu. The watch's own GPS records it; the
iPhone is not needed until you sync.

* **Before Start**: the GPS warms up ("Searching for GPS", then "GPS ready").
  Tap **START** (bottom half) when ready, or start anyway: distance counts from
  the first fix. The button goes back (GPS off).
* **Moving**: live **pace** is the big number (min/mi or min/km), with distance
  and elapsed time below and moving time under those. Pace is blank while the
  GPS is searching, lost (no fresh fix for 10 s) or stalled, and when you stop.
  The button **pauses**.
* **Splits**: Run buzzes at every mile by default and shows the mile number and
  its split time for 5 seconds, then live pace again. **Run & walk settings**:
  miles or km (also the pace units), buzz on or off for Run and for Walk (Walk
  is off by default). Each split buzzes exactly once: distance only ever grows,
  and the split count is saved, so GPS jitter at the boundary, a pause, leaving
  the app or a restart never repeats one. The phone is not involved.
* **Paused**: RESUME or FINISH; the button resumes. Distance and time while
  paused are not counted.
* **Finish**: SAVE or DISCARD (asks first). Saved runs and walks sync to the
  iPhone with their route and appear on **Today**.
* **Leaving the app pauses** the run and switches the GPS off; open NextSet
  Sync again to resume it. Keep the screen on the Run screen while moving.
* The GPS is switched off on Save, Discard, back and leaving the app.

How distance is counted (`gps.js`): fixes are averaged over 3 seconds; a point
counts once it is 10 m from the last counted one, so standing still adds
nothing; fixes with hdop above 6, a receiver repeating an old fix, and jumps
faster than 9 m/s are ignored; after a GPS gap the straight line is counted.
The tests replay seven synthetic tracks (`protocol/fixtures/gps-tracks.json`):
steady pace, a 60 s gap, a stalled fix, a pause while moving, jitter at a mile
boundary, a wild fix, and km units.

**Why not Recorder?** BangleApps Recorder was evaluated first. It records well,
but it is a widget-driven logger with its own track files and settings, has no
pause that excludes distance, splits or pace, and would make this app depend
on another app's file format for the one thing that must sync exactly once.
NextSet Sync therefore keeps its own small route log (one `seconds,lat,lon`
line every 15 m or 30 s, about 25 bytes a point, so an hour's run is about
10 KB) and you can still use Recorder for other activities.

## Steps

**Steps today** in the main menu shows the firmware's live count, and the
screen behind it shows the last seven days (from the Health app's log, by the
watch's own date). The iPhone gets the same daily totals each sync and replaces
each day's number, so syncing twice never doubles a day.

## Sleep

Install **Sleep Log** (0.26) too. Sleep Log records in the background; this
app's boot code serves its log to the iPhone, so nothing needs to stay open
overnight.

**Sleep face** (main menu): the square gold bezel and green reptile eye, for
the night. It blinks once when it opens, then every 30 to 90 seconds, but only
while the screen is already on: it never turns the screen or backlight on and
never changes brightness, and when the screen goes off every pending blink is
cancelled. When the screen comes back on it shows the open eye. (The Bangle.js 2
screen normally stays on with the backlight off, so by default the eye keeps
blinking unlit; if you set the screen to switch off, it stops until you look.) No clock and no
widgets. While it is open the watch uses your normal lock and backlight times
(not the longer ones used while lifting). The button (after the press that only
wakes the screen) goes back to the menu. Sleep Log keeps recording either way;
the face does not touch it.

## Files

`nsync.json` (watch id, paired phones), `nsync.wkt.json` (workout),
`nsync.ses.a.json`/`.b.json` (active session), `nsync.pend.a.json`/`.b.json`
(records waiting for the phone), `nsync.last.json` (last values per exercise).
The session and pending files are written alternately to two slots, because
Espruino's Storage erases a file's old copy before writing the new one; the
newest complete slot is always kept.

`nsync.json` and the session and pending files are deliberately **not**
listed under `data` in metadata.json. The App Loader's "Install App from Files"
erases an installed app's declared data files before reinstalling, so leaving
these undeclared means no install, reinstall or update can delete unsynced
sets, a workout in progress or the pairing. The cost: uninstalling leaves
those three small files behind. To remove them, delete `nsync.json`, `nsync.ses.*` and `nsync.pend.*` in the Espruino
Web IDE's storage manager (Storage icon).

Other files: `nsync.mark.a/b.json` (markers, kept like pending records),
`nsync.timer.json` (running timer), `nsync.sw.json` (stopwatch),
`nsync.run.a/b.json` (run or walk in progress), `nsync.act.a/b.json` (saved
runs and walks until the iPhone has them; kept like markers), `nsync.rt<start>`
(each route until the iPhone has stored it), `nsync.runcfg.json` (units and
buzz settings), `nsync.eye0.img` to `nsync.eye3.img` (Sleep face frames, made from
`design/sleep-face/` by `scripts/make-sleep-face.py`; 2-bit images with a
palette, read memory-mapped, so they use no RAM).

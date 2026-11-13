# NextSet Sync (Bangle.js 2)

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

Needs the **Scheduler** app (installed by default on Bangle.js 2; the App
Loader adds it if missing). Without it, timers buzz only while their screen
is open.

## Sleep

Install **Sleep Log** (0.26) too. Sleep Log records in the background; this
app's boot code serves its log to the iPhone, so nothing needs to stay open
overnight.

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
`nsync.timer.json` (running timer), `nsync.sw.json` (stopwatch).

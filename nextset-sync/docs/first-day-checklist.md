# First-day checklist

You need: your Windows PC with Chrome or Edge (the App Loader uses Web
Bluetooth), your iPhone (iOS 17 or later) with the **TestFlight** app, the
Bangle.js 2 and its charger, and your paid Apple Developer account. **No Mac:**
GitHub's macOS machines build and sign the iPhone app and send it to TestFlight.
About 45 minutes of setup spread over the week, plus one night.

## Before the watch arrives (this week)

1. **Put the iPhone app on your phone through TestFlight.** Follow
   [no-mac-setup.md](no-mac-setup.md): create the `nextset-sync` repository,
   register the app with Apple, make an API key, add three GitHub secrets, then
   **Actions → TestFlight → Run workflow** and install from TestFlight.
   About 30 minutes once, then about 20 minutes of waiting.
2. **Try demo mode** (no watch needed). In the app: **Settings → Demo mode** on. Then:
   * **Watch** tab: three sets are waiting on the simulated watch. Tap
     **Sync Now**, then **Walk away**, **Log a set on the watch** and **Come
     back**: the set syncs once.
   * **Workouts**: send *Full Body A*, create one with **+**, or import a
     NextSet plan or prescription JSON or a text file (Files app).
   * **History**: per-set status, **Export CSV**.
   * **Sleep**: nine demo nights, a seven-night chart, a nap and partial-night
     labels. Apple Health export is switched off in demo mode, so sample
     nights never reach your Health data.
3. **Get the watch files onto the PC.** On GitHub, open the `nextset-sync`
   repository → **Code → Download ZIP** → extract it. The watch app is the
   `watch/nsync` folder. (Before the repository exists, use the
   `claude/bangle-iphone-workout-sleep-x9j8xy` branch of
   `ai-medicine-collective` the same way; the folder is
   `nextset-sync/watch/nsync`.)

## When the watch arrives

4. **Charge** the watch until full, and press its button to wake it.
5. **Connect the App Loader.** On the Windows PC, open
   **https://banglejs.com/apps** in Chrome or Edge, click **Connect** (top
   right) and choose **Bangle.js xxxx**.
6. **Back up first:** **More** tab → **Backup**, which saves every file on
   the watch to a ZIP.
7. **Firmware 2v29 or later:** **Library** tab → search **Firmware Update**
   → click it and follow its page. The current version is shown at the top
   of that page. Updates keep your apps and data, but you have the backup
   anyway.
8. **Install Sleep Log:** **Library** → search **Sleep Log** → click the
    install arrow. Check that **My Apps** shows **Sleep Log 0.26**.
9. **Install NextSet Sync:** **More** tab → **Install App from Files** →
    select every file in the `watch/nsync` folder you extracted (`metadata.json`,
    `app.js`, `boot.js`, `lib.js`, `app-icon.js`, `app.png`, `README.md`,
    `ChangeLog`) → **OK**. The watch restarts and may show "Updating boot0..."
    once; that is the bootloader adding the new service. Check that **My
    Apps** lists both NextSet Sync 0.01 and Sleep Log 0.26.
    * This upload writes only NextSet Sync's own files. Sleep Log, your
      settings and other apps' data are untouched.
    * For later **updates**, install the same way. Pairing, unsynced sets and
      a workout in progress are kept: those files are deliberately not declared
      as app data (see `watch/nsync/README.md`).
10. **Click Disconnect** in the App Loader (top right). The watch accepts one
    connection at a time, and the iPhone can't connect while the App Loader is.

## Pair and connect

11. iPhone app: **Settings → Demo mode** off. **Watch → Search for watches**
    → tap **Bangle.js xxxx** → **Allow** when iOS asks for Bluetooth.
    If it says the sync service was not found, turn iPhone Bluetooth off and
    on in **Settings → Bluetooth** (iOS caches services), then try again.
12. Watch: press the button for the launcher → **NextSet Sync** → **Pair phone**.
13. iPhone: tap **Pair Watch**. The watch buzzes and shows your iPhone's name
    and a 4-digit code: check it matches the iPhone, then tap **Pair** on the
    watch. The app shows **Connected** and runs a first sync.

## Acceptance test (about 5 minutes)

| # | Do | Expect |
|---|---|---|
| A | iPhone: **Workouts → Quick test (2 sets) → Send to watch** | "Quick test (2 sets) is on the watch" |
| B | Watch: **NextSet Sync → Start Quick test** | Set screen: *Incline push-up, Set 1/2* |
| C | iPhone: **Watch → Disconnect (use the App Loader)** | Watch tab no longer says Connected |
| D | Watch: tap **REPS**, then **+** or **−** to pick a number, then **LOG** | Short buzz; 0:30 rest countdown; **strong double buzz at 0:00** |
| E | Watch: press the button → **Main menu** | "1 set to sync" (tap it: *Phone: not connected*) |
| F | iPhone: **Watch → Reconnect automatically** | Connects, syncs by itself; **Last sync** updates |
| G | iPhone: **History** → the session | The set appears **once**, with a green check (synced) |
| H | iPhone: **Sync Now** twice more, then **History → Export CSV** | Still one set; the CSV has exactly one data row |
| I | Watch: log set 2, press the button → **Finish workout** → **Finish**; iPhone: **Sync Now** | Session shows *finished* with 2 sets |

## First night

14. Before bed: watch on the wrist, not on the charger. Nothing needs to be
    open on the watch: Sleep Log records in the background.
15. Morning: open the iPhone app near the watch. It reconnects and syncs
    (or tap **Sync Now**). The **Sleep** tab shows estimated sleep, the sleep
    and wake times, and the night in the seven-night chart.
16. Optional: **Sleep → Export to Apple Health** → allow **Sleep** in Apple's
    sheet. In the Health app, **Browse → Sleep** shows an "Asleep" entry from
    NextSet Sync.

## Still to be confirmed on hardware

These are built and tested in software only. Tick each off on the day:

- [ ] Bluetooth pairing and reconnection with the real Bangle.js 2 (steps 11–13, F)
- [ ] Rest-timer vibration (D), and touch sizes being comfortable mid-workout
- [ ] Overnight Sleep Log recording and the morning sync (14–15)
- [ ] Apple Health writes on the iPhone (16)
- [ ] Reconnection while the app is in the background (lock the iPhone during C to F)

## If something goes wrong

* **"Search" finds nothing:** the App Loader or another phone is still
  connected (step 10), or the watch's Bluetooth is off (watch **Settings →
  Bluetooth**).
* **The App Loader can't connect:** tap **Disconnect** in the iPhone app first.
* **"The watch no longer recognises this iPhone":** **Forget this watch**,
  then pair again (steps 11–13).
* **Sync stopped part-way:** nothing is lost. Sets stay on the watch until the
  iPhone has saved them; just sync again.
* **Sleep tab is empty:** check that Sleep Log is installed and enabled
  (watch **Settings → Apps → Sleep Log**), and that the watch was worn and not
  charging.

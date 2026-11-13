# First-day checklist

You need: a Mac with Xcode 16 or later, your iPhone (iOS 17 or later) and its
cable, the Bangle.js 2 and its charger, and Chrome or Edge on any computer
(the App Loader uses Web Bluetooth; Safari and iPhone browsers can't).
About 45 minutes, plus one night.

## Before the watch arrives (today)

1. **Get the code on the Mac.** In Terminal:
   ```sh
   git clone -b claude/bangle-iphone-workout-sleep-x9j8xy https://github.com/DrZaff/ai-medicine-collective.git
   cd ai-medicine-collective/nextset-sync
   open ios/nextset-sync.xcodeproj
   ```
2. **Signing** (Xcode, once):
   1. In the left sidebar click the blue **nextset-sync** project, then the
      **NextSetSync** target, then the **Signing & Capabilities** tab.
   2. Leave **Automatically manage signing** ticked. Set **Team** to your
      Apple Developer team.
   3. **Bundle Identifier** is `com.zaffuto.nextsetsync`. If Xcode says it is
      unavailable, change it to something unique, e.g. `com.<you>.nextsetsync`.
   4. Check that **HealthKit** is listed (it comes from
      `config/nextset-sync.entitlements`). If Xcode reports the profile lacks
      HealthKit, click **+ Capability → HealthKit**, which registers it on
      your App ID.
   5. Bluetooth background mode is already in `config/info.plist`
      (`bluetooth-central`); nothing to add.
3. **Install on the iPhone**
   1. Plug the iPhone into the Mac, unlock it and tap **Trust**.
   2. First time only: on the iPhone, **Settings → Privacy & Security →
      Developer Mode → On**, then restart it.
   3. In Xcode's toolbar choose scheme **NextSetSync**, then your iPhone as
      the destination, then press **▶︎ Run** (⌘R).
   4. Free (personal) teams only: on the iPhone, **Settings → General → VPN &
      Device Management**, trust your developer certificate, then open the app.

   From the command line instead (after setting the team once in Xcode):
   ```sh
   xcodebuild -project ios/nextset-sync.xcodeproj -scheme NextSetSync \
     -destination 'platform=iOS,name=<your iPhone name>' -allowProvisioningUpdates build
   ```
   Simulator build check:
   `xcodebuild -project ios/nextset-sync.xcodeproj -scheme NextSetSync -destination 'generic/platform=iOS Simulator' build`.
   Bluetooth does not work in the Simulator; demo mode does.
4. **Try demo mode.** In the app: **Settings → Demo mode** on. Then:
   * **Watch** tab: three sets are waiting on the simulated watch. Tap
     **Sync Now**, then **Walk away**, **Log a set on the watch** and **Come
     back**: the set syncs once.
   * **Workouts**: send *Full Body A*, create one with **+**, or import a
     NextSet plan or prescription JSON or a text file.
   * **History**: per-set status, **Export CSV**.
   * **Sleep**: nine demo nights, a seven-night chart, a nap and partial-night
     labels. Apple Health export is switched off in demo mode, so sample nights
     never reach your Health data.
5. **Optional, on the Mac: run the tests.**
   `cd ios/NextSetSyncCore && swift test` runs 38 Swift tests (the 39th, the
   real-watch-code bridge, is skipped unless Espruino is built).
   `scripts/run-tests.sh` builds Espruino and runs everything (needs Node 22).

## When the watch arrives

6. **Charge** the watch until full, and press its button to wake it.
7. **Connect the App Loader.** On the computer, open
   **https://banglejs.com/apps** in Chrome or Edge, click **Connect** (top
   right) and choose **Bangle.js xxxx**.
8. **Back up first:** **More** tab → **Backup**, which saves every file on
   the watch to a ZIP.
9. **Firmware 2v29 or later:** **Library** tab → search **Firmware Update**
   → click it and follow its page. The current version is shown at the top
   of that page. Updates keep your apps and data, but you have the backup
   anyway.
10. **Install Sleep Log:** **Library** → search **Sleep Log** → click the
    install arrow. Check that **My Apps** shows **Sleep Log 0.26**.
11. **Install NextSet Sync:** **More** tab → **Install App from Files** →
    select every file in `nextset-sync/watch/nsync/` (`metadata.json`,
    `app.js`, `boot.js`, `lib.js`, `app-icon.js`, `app.png`, `README.md`,
    `ChangeLog`) → **OK**. The watch restarts and may show "Updating boot0..."
    once; that is the bootloader adding the new service. Check that **My
    Apps** lists both NextSet Sync 0.01 and Sleep Log 0.26.
    * This upload writes only NextSet Sync's own files. Sleep Log, your
      settings and other apps' data are untouched.
    * For later **updates**, install the same way. Pairing, unsynced sets and
      a workout in progress are kept: those files are deliberately not declared
      as app data (see `watch/nsync/README.md`).
12. **Click Disconnect** in the App Loader (top right). The watch accepts one
    connection at a time, and the iPhone can't connect while the App Loader is.

## Pair and connect

13. iPhone app: **Settings → Demo mode** off. **Watch → Search for watches**
    → tap **Bangle.js xxxx** → **Allow** when iOS asks for Bluetooth.
    If it says the sync service was not found, turn iPhone Bluetooth off and
    on in **Settings → Bluetooth** (iOS caches services), then try again.
14. Watch: press the button for the launcher → **NextSet Sync** → **Pair phone**.
15. iPhone: tap **Pair Watch**. The watch buzzes and shows your iPhone's name
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

16. Before bed: watch on the wrist, not on the charger. Nothing needs to be
    open on the watch: Sleep Log records in the background.
17. Morning: open the iPhone app near the watch. It reconnects and syncs
    (or tap **Sync Now**). The **Sleep** tab shows estimated sleep, the sleep
    and wake times, and the night in the seven-night chart.
18. Optional: **Sleep → Export to Apple Health** → allow **Sleep** in Apple's
    sheet. In the Health app, **Browse → Sleep** shows an "Asleep" entry from
    NextSet Sync.

## Still to be confirmed on hardware

These are built and tested in software only. Tick each off on the day:

- [ ] Bluetooth pairing and reconnection with the real Bangle.js 2 (steps 13–15, F)
- [ ] Rest-timer vibration (D), and touch sizes being comfortable mid-workout
- [ ] Overnight Sleep Log recording and the morning sync (16–17)
- [ ] Apple Health writes on the iPhone (18)
- [ ] Reconnection while the app is in the background (lock the iPhone during C to F)

## If something goes wrong

* **"Search" finds nothing:** the App Loader or another phone is still
  connected (step 12), or the watch's Bluetooth is off (watch **Settings →
  Bluetooth**).
* **The App Loader can't connect:** tap **Disconnect** in the iPhone app first.
* **"The watch no longer recognises this iPhone":** **Forget this watch**,
  then pair again (steps 13–15).
* **Sync stopped part-way:** nothing is lost. Sets stay on the watch until the
  iPhone has saved them; just sync again.
* **Sleep tab is empty:** check that Sleep Log is installed and enabled
  (watch **Settings → Apps → Sleep Log**), and that the watch was worn and not
  charging.

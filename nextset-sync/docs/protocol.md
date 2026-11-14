# NextSet Sync Bluetooth protocol, version 1

The contract between the watch (`watch/nsync/boot.js` + `lib.js`) and the
iPhone (`ios/NextSetSyncCore`: `wire.swift`, `sync.swift`). Both sides are
tested against the shared vectors in `protocol/vectors.json`, and the Swift
engine is tested against the real watch code running in Espruino
(`EspruinoBridgeTests`).

## GATT service

Registered by `nsync.boot.js` on every boot through the bootloader's shared
`bleServices` object (see "Boot behaviour"). Nothing has to be open on the
watch.

| | UUID | Properties | Max length |
|---|---|---|---|
| Service | `d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40` | primary | |
| RX (phone → watch) | `d9a50002-3c1f-4b0e-9f5d-7a1e6c2b8f40` | write, write without response | 128 |
| TX (watch → phone) | `d9a50003-3c1f-4b0e-9f5d-7a1e6c2b8f40` | notify, read | 128 |

The three UUIDs share one 128-bit base, so they use one of the softdevice's
10 vendor-UUID slots (`vs_uuid_count = 10` on nRF52, `targets/nrf5x/bluetooth.c`).
The Nordic UART service stays on (`bleServiceOptions.uart = true`), so the
App Loader and Web IDE keep working.

The watch does not advertise this service (a second 128-bit UUID does not fit
in the advertising packet with the UART UUID and name). The phone finds the
watch by its advertised name `Bangle.js xxxx`, then discovers the service
after connecting.

## Framing and chunking

Every message is one line of ASCII:

```
<byte length of JSON>:<JSON>\n
```

e.g. `52:{"t":"hello","v":1,"phone":"6F1C…","mtu":128,"q":1}\n`

* The line is cut into chunks of at most *chunk size* bytes, written in order.
  Chunk size = `min(128, max(20, maximumWriteValueLength(.withoutResponse)))`
  on the phone (the negotiated ATT MTU − 3; Bangle.js 2 negotiates up to MTU
  131, `NRF_SDH_BLE_GATT_MAX_MTU_SIZE=131` in `boards/BANGLEJS2.py`). The
  phone sends its size in `hello` (`mtu`) and the watch uses the same for
  notifications.
* The phone writes **with response**: each chunk is confirmed by the watch's
  Bluetooth stack before the next, which is the flow control.
* The watch queues notifications and sends them one at a time with
  `NRF.updateServices(…, notify: true)`, retrying every 40 ms when the
  softdevice queue is full, giving up after about 4 s.
* Receivers collect bytes until `\n`, check the length prefix, then parse.
  A wrong length or bad JSON is rejected (`err bad_frame` / `bad_json`), never
  half-read. Both sides drop partial buffers on disconnect.
* Text is ASCII. The phone turns typography into ASCII before sending
  (`8–12` → `8-12`, `×` → `x`) because watch fonts are ISO 8859-1; anything
  else is `\u` escaped. Espruino's `JSON.stringify` escapes non-ASCII as
  `\u00XX` on 2v29; the phone also accepts the older `\xHH` form.

## Messages

Every request carries `q` (a number); the answer echoes it. An error is
`{"t":"err","code":…,"re":<request type>}`.

| Request (phone) | Answer (watch) | Notes |
|---|---|---|
| `hello` `{v, phone, mtu, kinds}` | `hi` `{v, min, watch, app, fw, paired, nonce, sl, kinds}` | Always allowed. `kinds` (since watch 0.02): record kinds the phone stores; without it the watch assumes `["set","ses"]`. `sl` = Sleep Log `{ver, on, last}`; `nonce` = 64 random bits from `E.hwRand()`. |
| `pair` `{phone, name, code}` | `paired` `{key, watch}` | Only while the watch app shows **Pair phone**; waits until the person taps **Pair** on the watch (or `pair_refused`). |
| `auth` `{proof}` | `authok` | `proof = hex(SHA-256(key + ":" + nonce + ":" + phone))`. The nonce is single use. |
| `time` `{ms, tz}` | `ok` | Sets the watch clock and time zone (minutes east of UTC); saves `timezone` in `setting.json` only if it changed. |
| `status` | `st` `{pend, pendSets, ses, wkt, sAck, bat, free, now, sl}` | |
| `wput` `{w}` | `wack` `{id, rev}` | Stores the workout, reads it back from flash, **then** acknowledges. |
| `pull` `{max}` | `recs` `{recs, more, total}` | Oldest first, up to 20 per answer (phone asks for 8). Only kinds the phone listed. |
| `ack` `{ids: [[id, rev], …]}` | `acked` `{n, left}` | Watch deletes a set/session (or marks a marker synced) only if its stored `rev` ≤ the acknowledged rev. `left` counts only kinds this phone takes. |
| `sleep` `{since, max}` | `slp` `{since, now, entries, more, sl}` | Calls Sleep Log's own `require("sleeplog").readLog(since×600000, now)`. |
| `sack` `{upto}` | `ok` | Saves the sleep cursor (shown in `status`). |
| `health` `{since, max}` | `hlt` `{rows, more, hl, now}` | BangleApps Health log through its own reader: `[t10, steps, bpmMin, bpmMax, movement, activity]` rows after `since` (UTC 10-minute steps; UTC filing mode converted). `hl` = `{ver, hrm, utc}`, also in `hi`. |
| `unpair` | `ok` | Forgets this phone. |

Before `authok`, everything except `hello`, `pair` and `auth` is refused
with `unauthorized`.

### Records (`recs`)

```json
{"k":"set","id":"7a3c91e0-lz8k2q.0.2","rev":2,"sid":"7a3c91e0-lz8k2q","wid":"sample-quick-test",
 "wn":"Quick test (2 sets)","xi":0,"xid":"pushup","xn":"Incline push-up","set":2,
 "load":0,"units":"lb","reps":11,"rir":2,"at":1794600000000,"ed":1794600060000}
{"k":"ses","id":"7a3c91e0-lz8k2q","rev":1,"sid":"7a3c91e0-lz8k2q","wn":"…","start":…,"end":…,"n":2,"at":…}
```

```json
{"k":"chk","id":"7a3c91e0-clz8k2q9b","rev":1,"score":4,"at":1794600000000}
{"k":"mark","id":"7a3c91e0-mlz8k2q9a","rev":1,"label":"Coffee","at":1794600000000}
```

* Every record has `k`, `id`, `rev`, `at`; all other fields are optional, so
  the phone can decode a kind it doesn't know. **It acknowledges only kinds it
  stores**; anything else stays on the watch until a phone that understands it
  connects. A new kind means: the watch adds it to `KINDS`, the phone to
  `SyncProtocol.storedKinds` and its store, plus tests on both sides.
* Markers live on the watch in their own two-slot file (`nsync.mark.*`),
  up to 300 unsynced (new ones are refused, never dropped, when full); after
  acknowledgment the newest 30 are kept for the watch's Recent list. Notes
  added on the iPhone stay on the iPhone (`notes.json`) and survive re-imports.
* `id` is stable for the life of the record: `<watch id>-<session start in
  base-36 seconds>.<exercise index>.<set number>` for sets, the session id for
  `ses`. `rev` starts at 1 and increases on every edit on the watch; a
  deleted set is sent once more with `"del":1`.
* Field names follow NextSet's log rows (`docs/nextset-integration.md`).

### Workout (`wput`)

```json
{"id":"sample-full-body-a","rev":3,"name":"Full Body A","units":"lb",
 "ex":[{"id":"goblet","name":"Goblet squat","sets":3,"reps":"8-12","rir":2,"rest":120,"load":45,"inc":5}]}
```

1–12 exercises, 1–10 sets each (checked on both sides).

## Durability and duplicate protection

1. The watch writes a set to `nsync.pend.json` (Storage writes a new copy
   of the file, then drops the old one) the moment LOG is tapped, before
   anything else.
2. `pull` copies records; nothing is deleted.
3. The phone saves them with an atomic file write (`Data.write(.atomic)`:
   temporary file, then rename) and only then sends `ack`.
4. The watch deletes each acknowledged record whose stored rev ≤ the acked
   rev, so an edit made while the ack was in flight survives.
5. The phone keys records by `id` and keeps the highest `rev`: the same rev
   arriving again (ack lost, link dropped) is counted as a duplicate and not
   stored twice; a lower rev is ignored.

Every request is safe to repeat, so the phone's rule after any failure is
just to start again on the next connection. Records waiting on the watch
survive disconnects, app exits, reboots and reinstalls (see the watch README
on undeclared data files).

The phone shows two states per set: **saved here, awaiting watch
confirmation** (stored, ack not yet confirmed) and **synced** (the watch
confirmed). It also shows the watch's own pending count from `status`.

## Sleep

`readLog` returns `[t10, status, consecutive]` rows (see `docs/sleep-log.md`),
starting with a copy of the state in force at `since`, stamped `since`. The
phone:

* asks from 24 h before its cursor every time (Sleep Log fills in
  "consecutive" afterwards), 150 rows per page;
* drops that leading copy unless that time is already stored as a real
  transition;
* merges rows by `t10`: same row → unchanged, different → updated, new →
  added. Re-importing a night changes nothing.

## Authorization

* **Pairing** needs the person at the watch: the watch app must be on
  **Pair phone**, and they must tap **Pair** on a prompt showing the phone's
  name and the 4-digit code the iPhone displays. The watch then generates a
  128-bit key (`E.hwRand`), keeps it in `nsync.json` against the phone's
  random install id, and sends it once. Up to three phones are remembered.
* **Every later connection** authenticates with a fresh nonce:
  `SHA-256(key:nonce:phoneId)`. The key never travels again, and a recorded
  proof cannot be replayed.
* The phone refuses to sync with a watch whose id differs from the paired one.
* Limits, stated plainly: the link is not encrypted (Bangle.js does not bond
  by default), so someone recording the radio *during pairing* could learn the
  key, and the watch's normal Bluetooth console (the App Loader's channel) is
  open to any nearby device unless you turn off **Settings → Bluetooth →
  Programmable** (turn it back on to install apps). The data involved is
  workout sets and sleep estimates; pair at home.

## Boot behaviour (firmware 2v29, Bootloader 0.70)

* At boot (and on every app change, since `load()` resets the interpreter),
  `.boot0` runs. If the CRC of `setting.json`, every `*.js` file and the
  firmware commit changed, it first rebuilds itself (`bootupdate.js`), which
  happens automatically after installing this app.
* `.boot0` declares `bleServices = {}` and `bleServiceOptions = {uart:true}`,
  runs every `*.boot.js` (ours adds the service; iOS Integration adds
  `ancs`/`ams`/`cts`), and then calls `NRF.setServices(bleServices,
  bleServiceOptions)` once (Bootloader ChangeLog 0.34). Our file never calls
  `setServices` itself, so it cannot remove anyone else's service.
* Espruino applies a changed service table by restarting the softdevice; if a
  phone is connected that waits until it disconnects
  (`jswrap_ble_restart`). After installing the app, disconnect the App
  Loader, then connect from the iPhone.
* iOS caches a peripheral's services. If the iPhone connected before the app
  was installed and now reports "service not found", turn the iPhone's
  Bluetooth off and on (documented under `NRF.setServices`).

## Reconnection

The iPhone stores the watch's `CBPeripheral.identifier` and calls
`connect()` whenever it is not connected. Apple documents that connection
attempts do not time out, so iOS completes it when the watch comes back in
range, also in the background (`UIBackgroundModes: bluetooth-central`), with
state restoration (`CBCentralManagerOptionRestoreIdentifierKey`) relaunching
the app if the system had ended it (not after a force-quit). On connection the
phone runs hello → auth → time → pull/ack until empty → sleep → status, then
records the last-sync time. **Disconnect** on the Watch tab stops this so the
App Loader can use the watch (Bangle.js accepts one connection at a time).

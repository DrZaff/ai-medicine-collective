/* Runs inside the real Espruino 2v29 interpreter (Linux build) via run.mjs,
 * which prepends FILES (the app's files), VECTORS and FIXTURE.
 * Bluetooth (NRF), the Bangle object, the screen and menus are mocked;
 * Storage, StorageFile, JSON, crypto and timers are Espruino's own.
 * Each step prints "ok - ..." or "FAIL: ..."; `result` = 1 when all pass.
 */
var result = 0, fails = 0, passes = 0;
function ok(c, msg) { if (c) { passes++; print("ok - " + msg); } else { fails++; print("FAIL: " + msg); } }
var S = require("Storage");
var SVC = "d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40";
var RXC = "d9a50002-3c1f-4b0e-9f5d-7a1e6c2b8f40", TXC = "d9a50003-3c1f-4b0e-9f5d-7a1e6c2b8f40";

// ---- install the app's files the way the App Loader does ------------------
S.eraseAll();
S.write("nsync", FILES.lib);
S.write("nsync.boot.js", FILES.boot);
S.write("nsync.app.js", FILES.app);
S.write("nsync-tools", FILES.tools);
S.write("sleeplog", FILES.sleeplog);
S.write("sched", FILES.schedLib);           // Scheduler 0.43 (this app's dependency)
S.write("sched.boot.js", FILES.schedBoot);
S.write("health", FILES.healthLib);         // Health 0.44 and a synthetic November log
S.writeJSON("health.info", { id: "health", version: "0.44" });
S.write(FILES.healthExpected.file, atob(FILES.healthRawB64));
S.writeJSON("health.json", { hrm: 10, useUTC: true }); // the fixture is filed in UTC (the setting we recommend)
if (!Date.prototype.toLocalISOString) Date.prototype.toLocalISOString = function() { return this.toISOString(); };
S.writeJSON("sleeplog.info", { id: "sleeplog", version: "0.26" });
S.writeJSON(FIXTURE.archiveName, FIXTURE.archive);
var slf = S.open("sleeplog.log", "w");
slf.write(FIXTURE.log);
S.writeJSON("setting.json", { timezone: 0 });

// ---- mocks -------------------------------------------------------------------
global.NRF = {
  ev: {}, sent: [], failNext: 0, connected: true,
  on: function(e, f) { (this.ev[e] = this.ev[e] || []).push(f); },
  emitEv: function(e) { (this.ev[e] || []).forEach(function(f) { f(); }); },
  updateServices: function(u) {
    if (NRF.failNext > 0) { NRF.failNext--; throw new Error("BLE busy"); }
    var v = u[SVC][TXC];
    if (NRF.connected && v.notify) NRF.sent.push(v.value);
  },
  setServices: function() { ok(false, "boot code must not call NRF.setServices"); },
  getSecurityStatus: function() { return { connected: NRF.connected }; }
};
var ui = null, menu = null, prompt = null, buzzes = 0;
global.Bangle = {
  getOptions: function() { return { lockTimeout: 10000, backlightTimeout: 10000 }; },
  getHealthStatus: function() { return { steps: 123 }; },
  ev: {}, on: function(e, f) { (this.ev[e] = this.ev[e] || []).push(f); },
  emit: function(e, a) { (this.ev[e] || []).forEach(function(f) { f(a); }); },
  isLCDOn: function() { return true; },
  setOptions: function() {}, setLCDPower: function() {}, setLocked: function() {},
  buzz: function() { buzzes++; return Promise.resolve(); },
  setUI: function(o) { if (ui && ui.remove) ui.remove(); ui = o || null; }
};
function stubG() {
  var o = { theme: { fg: 7, bg: 0, fgH: 0, bgH: 7 } };
  ["reset", "clearRect", "fillRect", "drawRect", "setColor", "setFont", "setFontAlign", "drawString", "clear", "flip"].forEach(function(k) {
    o[k] = function() { return o; };
  });
  o.getWidth = function() { return 176; }; o.getHeight = function() { return 176; };
  o.stringWidth = function(s) { return ("" + s).length * 9; };
  return o;
}
global.g = stubG();
E.showMenu = function(m) { Bangle.setUI(); menu = m; return m; };
E.showPrompt = function(msg) { return new Promise(function(r) { prompt = { msg: msg, answer: r }; }); };
E.showAlert = function() { return Promise.resolve(); };
E.showMessage = function() {};
global.load = function() {};
global.bleServices = {};
global.bleServiceOptions = { uart: true };

// ---- the bootloader runs our boot file ----------------------------------------
eval(S.read("nsync.boot.js"));
ok(bleServices[SVC] && bleServices[SVC][RXC].writable && bleServices[SVC][TXC].notify,
  "boot adds the service to the bootloader's bleServices (UART kept: " + bleServiceOptions.uart + ")");
ok(bleServices[SVC][RXC].maxLen == 128 && bleServices[SVC][TXC].maxLen == 128, "characteristics sized for MTU 131");
ok(Modules.getCached().indexOf("nsync") < 0, "library not loaded at boot");

// ---- a tiny phone ------------------------------------------------------------
var inbuf = "", q = 0, chunk = 20;
function phone(obj) {
  obj.q = ++q;
  var s = JSON.stringify(obj); s = s.length + ":" + s + "\n";
  for (var i = 0; i < s.length; i += chunk) bleServices[SVC][RXC].onWrite({ data: E.toArrayBuffer(s.substr(i, chunk)) });
}
function rawWrite(str) { bleServices[SVC][RXC].onWrite({ data: E.toArrayBuffer(str) }); }
function received() {
  inbuf += NRF.sent.join(""); NRF.sent = [];
  var out = [], i;
  while ((i = inbuf.indexOf("\n")) >= 0) {
    var l = inbuf.substr(0, i); inbuf = inbuf.substr(i + 1);
    var c = l.indexOf(":"), body = l.substr(c + 1);
    if (parseInt(l, 10) != body.length) ok(false, "frame length matches body");
    out.push(JSON.parse(body));
  }
  return out;
}
function disconnect() { NRF.connected = false; NRF.emitEv("disconnect"); inbuf = ""; NRF.sent = []; NRF.connected = true; }
function sha(s) { return require("nsync").sha256hex(s); }

var steps = [], key, nonce, PID = VECTORS.proof.phone;
function step(f) { steps.push(f); }
function next() {
  var f = steps.shift();
  if (!f) {
    print("# " + passes + " passed, " + fails + " failed");
    E.emit("kill");          // the app saves and restores watch options
    clearInterval(); clearTimeout(); // stop the app's clock so the test goes idle
    result = fails ? 0 : 1;
    return;
  }
  f();
  setTimeout(next, 250); // let the notification queue drain
}
function last() { var m = received(); return m[m.length - 1]; }

step(function() {
  ok(sha(VECTORS.proof.input) == VECTORS.proof.sha256hex, "SHA-256 proof matches the shared vector");
  ok(sha("abc") == VECTORS.sha256[0].hex, "SHA-256('abc') matches");
  phone({ t: "hello", v: 1, phone: PID, mtu: 20 });
});
step(function() {
  var m = last();
  ok(m && m.t == "hi" && m.v == 1 && m.paired === false && m.nonce.length == 16, "hello -> hi, not paired yet");
  ok(m.sl && m.sl.ver == "0.26", "reports Sleep Log version " + (m.sl && m.sl.ver));
  ok(m.q == q, "response echoes the request number");
  phone({ t: "status" });
});
step(function() {
  var m = last(); ok(m.t == "err" && m.code == "unauthorized", "status refused before auth");
  phone({ t: "pair", phone: PID, name: "Test iPhone", code: "4821" });
});
step(function() {
  var m = last(); ok(m.t == "err" && m.code == "not_pairing", "pair refused unless the watch is on Pair phone");
  global.NSYNC_PAIR = function(name, code, cb) { ok(name == "Test iPhone" && code == "4821", "watch shows phone name and code"); cb(true); };
  phone({ t: "pair", phone: PID, name: "Test iPhone", code: "4821" });
});
step(function() {
  var m = last(); key = m && m.key;
  ok(m.t == "paired" && key.length == 32 && /^[0-9a-f]+$/.test(key), "user confirmed: paired, 128-bit key");
  delete global.NSYNC_PAIR;
  disconnect();
  phone({ t: "hello", v: 1, phone: PID, mtu: 128 });
});
step(function() {
  var m = last(); nonce = m.nonce;
  ok(m.paired === true, "after reconnect the watch knows this phone");
  phone({ t: "auth", proof: sha("00000000000000000000000000000000" + ":" + nonce + ":" + PID) });
});
step(function() {
  ok(last().code == "auth_failed", "wrong key refused");
  phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) });
});
step(function() {
  ok(last().code == "auth_failed", "nonce is single use (replay refused)");
  phone({ t: "hello", v: 1, phone: PID, mtu: 20 });
});
step(function() { nonce = last().nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() {
  ok(last().t == "authok", "correct proof accepted");
  phone({ t: "time", ms: Date.now(), tz: -300 });
});
step(function() {
  ok(last().re == "time" && S.readJSON("setting.json").timezone == -5, "time zone saved to setting.json (-5 h)");
  NRF.failNext = 3; // softdevice busy for three notifications
  phone({ t: "wput", w: {
    id: "sample-upper-a", rev: 2, name: "Upper A", units: "lb", ex: [
      { id: "bench", name: "Bench press", sets: 2, reps: "6-8", rir: 2, rest: 120, load: 135 },
      { id: "row", name: "Chest-supported row", sets: 2, reps: "8-12", rir: 2, rest: 90 }] } });
});
step(function() {
  var m = last();
  ok(m.t == "wack" && m.id == "sample-upper-a" && m.rev == 2, "workout stored durably, then acknowledged (despite 3 busy notifications)");
  ok(S.readJSON("nsync.wkt.json").ex.length == 2, "workout on flash");
  // ---- the watch app: phone goes away, sets are logged offline ----
  disconnect();
  NRF.connected = false;
  eval(S.read("nsync.app.js"));
  // The app is evaluated in this step's scope; hand later steps what they need.
  global.APPX = { matchesGhost: matchesGhost, rememberLast: rememberLast, scheduleRest: scheduleRest, save: save,
    setSes: function(v) { ses = v; } };
  ok(menu && Object.keys(menu).some(function(k) { return k.indexOf("Start Upper A") == 0; }), "main menu offers Start Upper A");
  // Silent timer: saved, buzzes via the Scheduler, survives the button.
  menu["Timers"]();
  menu["Focus (25m)"]();
  var sc = require("sched");
  ok(ui && ui.mode == "custom" && S.readJSON("nsync.timer.json").title == "Focus", "focus timer runs and is saved");
  ok(sc.getAlarm("nsync.timer") && sc.getAlarm("nsync.warn"), "end and 1-minute buzzes are Scheduler alarms");
  Bangle.emit("lock", false);          // the press that wakes the screen...
  ui.btn();                            // ...must not leave the timer screen
  ok(ui && ui.mode == "custom", "unlock press is ignored (timer screen stays)");
});
step(function() {}); // let the 400 ms unlock window pass
step(function() {
  ui.btn();                            // a deliberate press later: back to the menu
  ok(menu && Object.keys(menu).some(function(k) { return k.indexOf("> Focus") == 0; }), "button returns to the menu; timer keeps running");
  ok(require("sched").getAlarm("nsync.timer"), "Scheduler alarm still set after leaving the timer screen");
  menu[Object.keys(menu).filter(function(k) { return k.indexOf("> Focus") == 0; })[0]]();
  ui.touch(1, { x: 150, y: 140 });     // End...
  ok(prompt && prompt.msg.indexOf("End Focus") == 0, "ending asks first");
  prompt.answer(1);
});
step(function() {
  ok(!S.read("nsync.timer.json") && !require("sched").getAlarm("nsync.timer") && !require("sched").getAlarm("nsync.warn"),
    "confirmed End removes the timer and both alarms");
  menu["Stopwatch"]();
  ui.touch(1, { x: 30, y: 140 });      // start
  ui.btn();                            // leave the screen
  ok(S.readJSON("nsync.sw.json").started > 0, "stopwatch keeps counting after leaving its screen");
  menu["Stopwatch"]();
  ui.touch(1, { x: 30, y: 140 });      // pause
  ui.btn();
  menu[""].back();
  // Markers: crash-safe records with stable ids.
  menu["Mark a moment"]();
  menu["Coffee"]();
  var mk = require("nsync").marks(), mid = Object.keys(mk)[0];
  ok(mk[mid].label == "Coffee" && mk[mid].k == "mark" && mid.indexOf("-m") > 0 && S.read("nsync.mark.a.json"),
    "marker stored with a stable id in the two-slot file");
  menu[""].back();                     // leave before the 'marked' message times out
});
step(function() {
  ok(menu && Object.keys(menu).some(function(k) { return k.indexOf("Start") == 0; }), "leaving markers is not undone by the delayed redraw");
  menu["Retro progress"]();
  ok(ui && ui.mode == "custom", "retro progress opens offline");
  Bangle.emit("lock", true);
});
step(function() {
  ui.btn();
  menu[Object.keys(menu).filter(function(k) { return k.indexOf("Start") == 0; })[0]]();
  ok(APPX.matchesGhost({ load: 135, reps: 5, rir: 2 }, { load: 140, reps: 5, rir: 2 }),
    "ghost rewards more load with matching reps and RIR");
  ok(!APPX.matchesGhost({ load: 135, reps: 5, rir: 2 }, { load: 140, reps: 4, rir: 2 }),
    "ghost rejects more load at fewer reps");
  ok(ui && ui.mode == "custom", "set entry screen shown");
  ui.touch(1, { x: 87, y: 140 });  // + on load (selected by default): 135 -> 140
  ui.touch(1, { x: 87, y: 60 });   // select REPS
  ui.touch(1, { x: 30, y: 140 });  // - : 6 -> 5
  ui.touch(1, { x: 30, y: 140 });  // -> 4
  ui.touch(1, { x: 87, y: 140 });  // -> 5
  ui.touch(1, { x: 150, y: 140 }); // LOG
  var p = require("nsync").pend();
  var r = p[Object.keys(p)[0]];
  ok(Object.keys(p).length == 1 && r.load == 140 && r.reps == 5 && r.rir == 2 && r.set == 1 && r.xid == "bench", "set 1 logged offline: 140 lb x 5 @2");
  ok(buzzes > 0, "haptic confirmation on LOG");
  var ses = require("nsync").readSes();
  ok(ses.restEnd > Date.now() && ses.sn == 2, "rest timer running, saved with the session");
  var ra = require("sched").getAlarm("nsync.rest");
  ok(ses.restAlarm && ra && ra.js.indexOf("fireAlarm") > 0, "rest end buzz is a Scheduler alarm (fires outside the app too)");
  var before = buzzes; eval(ra.js);
  ok(buzzes > before && !require("sched").getAlarm("nsync.rest"), "the alarm buzzes and removes itself");
  APPX.scheduleRest(); APPX.save();
  ok(ui.touch && menu, "rest screen active");
  ui.touch(1, { x: 150, y: 140 }); // SKIP rest
  ok(!require("sched").getAlarm("nsync.rest"), "skipping rest cancels its alarm");
  ui.touch(1, { x: 150, y: 140 }); // LOG set 2 (prefilled from set 1)
  // A typo then fixed or deleted must not become the next baseline.
  var sesNow = require("nsync").readSes();
  var typo = sesNow.recs[sesNow.recs.length - 1];
  typo.load = 1400; typo.ed = Date.now(); APPX.setSes(sesNow); APPX.rememberLast(typo.xid);
  ok(S.readJSON("nsync.last.json").bench.load == 1400, "last-set memory follows the newest set");
  typo.del = 1; APPX.rememberLast(typo.xid);
  ok(S.readJSON("nsync.last.json").bench.load == 140, "deleting it restores the previous live set (140)");
  typo.del = 0; typo.load = 140; APPX.rememberLast(typo.xid); APPX.save();
  // App killed mid-rest (or the watch rebooted): state is reloaded from flash.
  E.emit("kill");
  ui = null; menu = null;
  eval(S.read("nsync.app.js"));
  var s2 = require("nsync").readSes();
  ok(s2 && s2.xi == 1 && s2.sn == 1 && s2.recs.length == 2, "session resumed after restart at exercise 2, set 1");
  ok(ui && ui.mode == "custom", "resumes straight into the rest/set screen");
  ses = s2;
});
step(function() {
  // Edit set 1 after it was logged (still offline).
  var s = require("nsync").readSes();
  var r1 = s.recs[0];
  var p = require("nsync").pend();
  var r1e = Object.assign({}, r1, { reps: 6, rev: r1.rev + 1 });
  require("nsync").putRec(r1e);
  ok(require("nsync").pend()[r1.id].rev == 2, "edited set keeps its id with rev 2");
  ok(Object.keys(p).length == 2, "two sets waiting");
  NRF.connected = true;
  phone({ t: "hello", v: 1, phone: PID, mtu: 20 });
});
step(function() { nonce = last().nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() { received(); phone({ t: "status" }); });
step(function() {
  var m = last();
  ok(m.t == "st" && m.pendSets == 2 && m.ses && m.ses.n == 2 && m.wkt.id == "sample-upper-a", "status: 2 pending sets, session in progress");
  phone({ t: "pull", max: 1 });
});
step(function() {
  var m = last();
  ok(m.t == "recs" && m.recs.length == 1 && m.more === true && m.total == 2, "pull is paged (1 of 2, more)");
  phone({ t: "pull" });
});
var got;
step(function() {
  var m = last(); got = m.recs;
  ok(got.length == 2 && !m.more, "pull returns both sets");
  // Interrupted transfer: the phone stored only the first record, then the link dropped
  // halfway through its ack frame.
  rawWrite('40:{"t":"ack","ids":[["' + got[0].id);
  disconnect();
  phone({ t: "hello", v: 1, phone: PID, mtu: 128 });
});
step(function() { nonce = last().nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() {
  ok(last().t == "authok", "half-sent frame was discarded on disconnect");
  phone({ t: "pull" });
});
step(function() {
  var m = last();
  ok(m.recs.length == 2, "nothing was removed without an ack: both sets offered again");
  phone({ t: "ack", ids: [[got[0].id, got[0].rev]] });
});
step(function() {
  var m = last();
  ok(m.t == "acked" && m.n == 1 && m.left == 1, "ack after durable phone write removes exactly that set");
  phone({ t: "ack", ids: [[got[0].id, got[0].rev]] });
});
step(function() {
  ok(last().n == 0, "repeated ack is harmless");
  // An edit that happens after the phone took rev 1 must not be lost by a late ack of rev 1.
  var s = require("nsync").readSes();
  require("nsync").putRec(Object.assign({}, s.recs[1], { reps: 9, rev: 1 }));
  phone({ t: "ack", ids: [[got[1].id, 1]] });
});
step(function() {
  var p = require("nsync").pend();
  ok(Object.keys(p).length == 1 && p[got[1].id].rev == 2 && p[got[1].id].reps == 9, "ack of an older rev keeps the newer edit pending");
  rawWrite("99:{\"t\":\"status\"}\n");
});
step(function() {
  ok(last().code == "bad_frame", "corrupted frame rejected");
  phone({ t: "sleep", since: FIXTURE.first - 1, max: 40 });
});
var sleepAll = [];
step(function() {
  var m = last();
  ok(m.t == "slp" && m.entries.length == 40 && m.more === true, "Sleep Log read through its own readLog, paged (40, more)");
  ok(Modules.getCached().indexOf("sleeplog") < 0, "sleeplog module unloaded afterwards");
  sleepAll = m.entries;
  phone({ t: "sleep", since: m.entries[m.entries.length - 1][0], max: 300 });
});
step(function() {
  var m = last();
  sleepAll = sleepAll.concat(m.entries.slice(1));
  ok(!m.more, "second page completes the log");
  ok(sleepAll[0][0] == FIXTURE.first - 1 || sleepAll[0][0] == FIXTURE.first, "starts at the requested time");
  var hasArchive = sleepAll.some(function(e) { return e[0] == FIXTURE.archive[5][0]; });
  var hasCurrent = sleepAll.some(function(e) { return e[0] == FIXTURE.lastT10; });
  ok(hasArchive && hasCurrent, "covers both the fortnight archive and the current log");
  phone({ t: "sack", upto: FIXTURE.lastT10 });
});
step(function() {
  ok(S.readJSON("nsync.json").sAck == FIXTURE.lastT10, "sleep cursor saved");
  // Finish the workout on the watch.
  ui.touch && ui.touch(1, { x: 150, y: 140 });
  phone({ t: "status" });
});
step(function() { received(); });

step(function() {
  // Power lost while writing: the newest pending slot is half-written.
  var L = require("nsync");
  var before = Object.keys(L.pend()).length;
  L.putRec({ k: "set", id: "crash.0.1", rev: 1, sid: "crash", xi: 0, xn: "X", set: 1, load: 1, units: "lb", reps: 1, rir: 1, at: Date.now() });
  var a = S.readJSON("nsync.pend.a.json", 1), b = S.readJSON("nsync.pend.b.json", 1);
  var newest = a.g > b.g ? "nsync.pend.a.json" : "nsync.pend.b.json";
  S.write(newest, '{"g":99,"d":{"crash.0.1":{"k":"se');
  ok(Object.keys(L.pend()).length == before, "torn write: previous complete version of the pending list is used");
  L.putRec({ k: "set", id: "crash.0.2", rev: 1, sid: "crash", xi: 0, xn: "X", set: 2, load: 1, units: "lb", reps: 1, rir: 1, at: Date.now() });
  ok(Object.keys(L.pend()).length == before + 1, "next write goes on from the intact version");
});

// ---- markers through sync: kinds negotiation ----------------------------------
step(function() { disconnect(); phone({ t: "hello", v: 1, phone: PID, mtu: 128 }); }); // an older phone: no kinds
step(function() { nonce = last().nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() { received(); phone({ t: "pull", max: 20 }); });
var oldPull;
step(function() {
  oldPull = last();
  ok(oldPull.recs.length > 0 && !oldPull.recs.some(function(r) { return r.k == "mark"; }), "an older phone never receives markers");
  phone({ t: "ack", ids: oldPull.recs.map(function(r) { return [r.id, r.rev]; }) });
});
step(function() {
  var a = last();
  ok(a.t == "acked" && a.left == 0, "left counts only kinds that phone takes (no endless wait)");
  ok(require("nsync").markCount().unsynced == 1, "the marker is kept on the watch for a newer phone");
  disconnect();
  phone({ t: "hello", v: 1, phone: PID, mtu: 128, kinds: ["set", "ses", "mark"] });
});
step(function() {
  var h = last();
  ok(h.kinds && h.kinds.indexOf("mark") >= 0, "watch lists the kinds it can send");
  nonce = h.nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) });
});
step(function() { received(); phone({ t: "pull", max: 20 }); });
var markRec;
step(function() {
  var m = last();
  markRec = m.recs.filter(function(r) { return r.k == "mark"; })[0];
  ok(markRec && markRec.label == "Coffee" && markRec.rev == 1, "a phone that takes markers receives them");
  phone({ t: "ack", ids: [[markRec.id, markRec.rev]] });
});
step(function() {
  var L = require("nsync");
  ok(last().n == 1 && L.markCount().unsynced == 0 && L.marks()[markRec.id].synced, "acked marker is kept as synced history");
  phone({ t: "ack", ids: [[markRec.id, markRec.rev]] });
});
step(function() {
  var L = require("nsync");
  ok(last().n == 0, "repeated marker ack is harmless");
  var cap = L.MAX_MARKS; L.MAX_MARKS = 1;
  L.addMark("Idea");
  var refused = false; try { L.addMark("Idea"); } catch (e) { refused = e.message.indexOf("Sync") >= 0; }
  ok(refused && L.markCount().unsynced == 1, "full marker log refuses new ones and keeps the old ones");
  L.MAX_MARKS = cap;
  var before = L.markCount().n;
  var a = S.readJSON("nsync.mark.a.json", 1), b = S.readJSON("nsync.mark.b.json", 1);
  S.write(a.g > b.g ? "nsync.mark.a.json" : "nsync.mark.b.json", '{"g":99,"d":{"x');
  ok(L.markCount().n == before - 1 || L.markCount().n == before, "torn marker write falls back to the previous complete list");
  ok(L.markCount().n >= 1, "markers survive the torn write");
});

// ---- self-test -------------------------------------------------------------
step(function() {
  var L = require("nsync");
  S.write(".boot0", "var bleServices={};/* ... */bleServices['d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40']={};");
  S.writeJSON("setting.json", { timezone: -5, whitelist: ["aa:bb"] });
  S.writeJSON("health.json", { hrm: 0, useUTC: true });   // HRM polling off for this check
  var r = L.selfTest(), by = {};
  r.forEach(function(c) { by[c.n.split(" ")[0]] = c; });
  ok(by.Sync && by.Sync.s == "ok", "self-test: sync service registered at boot");
  ok(by.Scheduler.s == "ok", "self-test: Scheduler present");
  ok(by.Whitelist && by.Whitelist.s == "warn", "self-test warns that the whitelist can block an iPhone");
  ok(by.Heart && by.Heart.s == "warn" && by.Heart.d.indexOf("HRM") >= 0, "self-test points to the Health HRM setting");
  ok(by.Paired.s == "ok" && by.Clock.s == "ok", "self-test: paired phone and sane clock");
  S.write(".boot0", "nothing here");
  ok(L.selfTest().filter(function(c) { return c.n == "Sync service"; })[0].s == "fail", "self-test fails when the bootloader has not included the service");
});

// ---- heart rate (Health app log) and check-ins --------------------------------
var hx = FILES.healthExpected;
step(function() {
  var L = require("nsync");
  ok(L.healthInfo().ver == "0.44", "hello reports the Health app version");
  var since = hx.lastSlotT10 - 36;          // the last 6 hours of the log
  var r = L.healthRows(since, 300);
  ok(r.rows.length == 36 && r.rows[0][0] == since + 1 && r.rows[35][0] == hx.lastSlotT10, "reads 10-minute rows after the cursor, in order");
  var lows = r.rows.filter(function(x) { return x[2] == hx.resting["2026-11-13"]; });
  ok(lows.length == 3 && lows[1][0] - lows[0][0] == 1, "the 30-minute resting window comes through (3 slots at 50 bpm)");
  var paged = L.healthRows(since, 10);
  ok(paged.rows.length == 10 && paged.more, "health rows are paged");
  ok(L.healthRows(hx.lastSlotT10, 50).rows.length == 0, "nothing after the newest slot");
  L.addCheckin(4);
  disconnect();
  phone({ t: "hello", v: 1, phone: PID, mtu: 128, kinds: ["set", "ses", "mark"] }); // knows markers, not check-ins
});
step(function() { var h = last(); ok(h.hl && h.hl.ver == "0.44", "hi carries Health app info"); nonce = h.nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() { received(); phone({ t: "pull", max: 20 }); });
step(function() {
  var m = last();
  ok(!m.recs.some(function(r) { return r.k == "chk"; }), "a phone without check-in support never gets them");
  disconnect();
  phone({ t: "hello", v: 1, phone: PID, mtu: 128, kinds: ["set", "ses", "mark", "chk"] });
});
step(function() { nonce = last().nonce; phone({ t: "auth", proof: sha(key + ":" + nonce + ":" + PID) }); });
step(function() { received(); phone({ t: "pull", max: 20 }); });
var chk;
step(function() {
  chk = last().recs.filter(function(r) { return r.k == "chk"; })[0];
  ok(chk && chk.score == 4 && chk.id.indexOf("-c") > 0, "check-in syncs with its score and a stable id");
  phone({ t: "ack", ids: [[chk.id, chk.rev]] });
});
step(function() {
  ok(last().n == 1 && require("nsync").marks()[chk.id].synced, "acked check-in is kept as synced");
  phone({ t: "health", since: hx.lastSlotT10 - 6, max: 100 });
});
step(function() {
  var m = last();
  ok(m.t == "hlt" && m.rows.length == 6 && m.hl.ver == "0.44", "the phone's health request returns rows over Bluetooth");
});

next();

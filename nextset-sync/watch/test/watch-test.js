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
S.write("sleeplog", FILES.sleeplog);
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
  setOptions: function() {}, on: function() {}, setLCDPower: function() {}, setLocked: function() {},
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
  ok(menu && Object.keys(menu).some(function(k) { return k.indexOf("Start Upper A") == 0; }), "main menu offers Start Upper A");
  menu[Object.keys(menu).filter(function(k) { return k.indexOf("Start") == 0; })[0]]();
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
  ok(ui.touch && menu, "rest screen active");
  ui.touch(1, { x: 150, y: 140 }); // SKIP rest
  ui.touch(1, { x: 150, y: 140 }); // LOG set 2 (prefilled from set 1)
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

next();

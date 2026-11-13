/* NextSet Sync - shared library (Storage module "nsync").
 * Protocol v1 over the custom GATT service registered in nsync.boot.js.
 * Loaded on demand (when the phone writes, or by the app), never at boot,
 * so it costs no RAM while idle. See docs/protocol.md.
 *
 * Wire format: every message is ASCII "<len>:<json>\n", split into chunks
 * of at most st.mtu bytes. <len> is the JSON byte length, so a frame that
 * lost or gained bytes is rejected instead of misread.
 */
var S = require("Storage");
var SVC = "d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40";
var TXC = "d9a50003-3c1f-4b0e-9f5d-7a1e6c2b8f40";
var F = {
  cfg: "nsync.json",       // watch id, paired phones, sleep cursor, last sync
  wkt: "nsync.wkt.json",   // workout sent by the phone
  ses: "nsync.ses",        // active session: nsync.ses.a.json / .b.json
  pend: "nsync.pend",      // unacknowledged records: nsync.pend.a.json / .b.json
  last: "nsync.last.json"  // last load/reps/RIR per exercise id (prefill)
};
exports.F = F;
exports.SVC = SVC;
exports.VERSION = "0.01";
exports.PROTO = 1;
exports.MAX_PEND = 600;

function hex(nbytes) {
  var s = "";
  while (s.length < nbytes * 2) {
    var r = E.hwRand ? E.hwRand() : Math.floor(Math.random() * 4294967296);
    s += ("00000000" + (r >>> 0).toString(16)).substr(-8);
  }
  return s.substr(0, nbytes * 2);
}
exports.hex = hex;

function sha256hex(str) {
  var a = new Uint8Array(require("crypto").SHA256(str)), s = "";
  for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
  return s;
}
exports.sha256hex = sha256hex;

exports.cfg = function() {
  var c = S.readJSON(F.cfg, 1) || {};
  var dirty = false;
  if (!c.wid) { c.wid = hex(4); dirty = true; }
  if (!c.phones) { c.phones = {}; dirty = true; }
  if (dirty) S.writeJSON(F.cfg, c);
  return c;
};
exports.saveCfg = function(c) { S.writeJSON(F.cfg, c); };

// Storage.write erases a file's old copy before writing the new one, so a
// crash in between would lose it. The two files that must never be lost are
// therefore written alternately to two slots with a generation number; the
// newest complete slot wins. Losing power mid-write costs at most that write.
function readDual(base) {
  var a = S.readJSON(base + ".a.json", 1), b = S.readJSON(base + ".b.json", 1);
  var w = a && b ? (a.g > b.g ? a : b) : (a || b);
  return w ? w.d : undefined;
}
function writeDual(base, d) {
  var a = S.readJSON(base + ".a.json", 1), b = S.readJSON(base + ".b.json", 1);
  var g = Math.max(a ? a.g : 0, b ? b.g : 0) + 1;
  S.writeJSON(base + (g & 1 ? ".a.json" : ".b.json"), { g: g, d: d });
}
function eraseDual(base) { S.erase(base + ".a.json"); S.erase(base + ".b.json"); }
exports.readSes = function() { return readDual(F.ses); };
exports.writeSes = function(s) { writeDual(F.ses, s); };
exports.eraseSes = function() { eraseDual(F.ses); };

exports.pend = function() { return readDual(F.pend) || {}; };
exports.pendCount = function() {
  var p = exports.pend(), n = 0, sets = 0;
  for (var k in p) { n++; if (p[k].k == "set") sets++; }
  return { n: n, sets: sets };
};
// Store a record durably until the phone acknowledges it. Edits reuse the
// id with a higher rev, so the phone keeps exactly one copy of each record.
exports.putRec = function(rec) {
  var p = exports.pend();
  var old = p[rec.id];
  if (old && old.rev >= rec.rev) rec.rev = old.rev + 1;
  p[rec.id] = rec;
  var keys = Object.keys(p);
  if (keys.length > exports.MAX_PEND) {
    // Never silently drop: refuse new work until the phone syncs.
    throw new Error("Sync needed");
  }
  writeDual(F.pend, p);
  if (E.emit) E.emit("nsync", "pend");
  return rec;
};

function sleeplogInfo() {
  var info = S.readJSON("sleeplog.info", 1);
  var sl = global.sleeplog;
  return {
    ver: info ? info.version : null,
    on: !!(sl && sl.conf && sl.conf.enabled),
    last: sl && sl.info && sl.info.lastCheck ? (sl.info.lastCheck / 6E5) | 0 : null
  };
}
exports.sleeplogInfo = sleeplogInfo;

// ---- outgoing frames -------------------------------------------------------
function send(st, o) {
  var s = JSON.stringify(o);
  s = s.length + ":" + s + "\n";
  var n = st.mtu || 20;
  for (var i = 0; i < s.length; i += n) st.q.push(s.substr(i, n));
  if (!st.busy) { st.busy = 1; tx(st); }
}
exports.send = send;

function tx(st) {
  if (!st.q.length) { st.busy = 0; return; }
  var c = st.q[0];
  try {
    var u = {}; u[SVC] = {}; u[SVC][TXC] = { value: c, notify: true };
    NRF.updateServices(u);
    st.q.shift();
    st.fails = 0;
  } catch (e) {
    // Softdevice queue full (or link gone): retry, give up after ~4 s.
    if (++st.fails > 100) { st.q = []; st.busy = 0; return; }
  }
  setTimeout(tx, st.fails ? 40 : 6, st);
}

// ---- incoming frames -------------------------------------------------------
exports.onLine = function(st, line) {
  var i = line.indexOf(":");
  var n = parseInt(line.substr(0, i), 10);
  var body = line.substr(i + 1);
  if (i < 1 || isNaN(n) || body.length !== n) return send(st, { t: "err", code: "bad_frame" });
  var m;
  try { m = JSON.parse(body); } catch (e) { return send(st, { t: "err", code: "bad_json" }); }
  var r;
  try { r = handle(st, m); } catch (e) {
    r = { t: "err", code: "exception", msg: ("" + (e.message || e)).substr(0, 60) };
  }
  if (r) {
    if (m.q !== undefined) r.q = m.q;
    send(st, r);
  }
};

function err(code, re) { return { t: "err", code: code, re: re }; }

function validWorkout(w) {
  if (!w || typeof w.id != "string" || typeof w.name != "string" || !Array.isArray(w.ex)) return false;
  if (w.ex.length < 1 || w.ex.length > 12) return false;
  return w.ex.every(function(x) {
    return x && typeof x.name == "string" && x.sets >= 1 && x.sets <= 10;
  });
}

function handle(st, m) {
  var c;
  switch (m.t) {
    case "hello":
      c = exports.cfg();
      st.pid = typeof m.phone == "string" ? m.phone.substr(0, 40) : undefined;
      st.mtu = Math.max(20, Math.min(128, m.mtu | 0));
      st.auth = 0;
      st.nonce = hex(8);
      return {
        t: "hi", v: exports.PROTO, min: 1, watch: c.wid, app: exports.VERSION,
        fw: process.env.VERSION, paired: !!(st.pid && c.phones[st.pid]),
        nonce: st.nonce, sl: sleeplogInfo()
      };
    case "pair":
      if (!st.pid || m.phone !== st.pid) return err("hello_first", "pair");
      if (typeof global.NSYNC_PAIR != "function") return err("not_pairing", "pair");
      var q = m.q;
      global.NSYNC_PAIR(("" + (m.name || "iPhone")).substr(0, 20), ("" + (m.code || "")).substr(0, 6), function(ok) {
        if (!ok) return send(st, { t: "err", code: "pair_refused", re: "pair", q: q });
        var cc = exports.cfg();
        var ids = Object.keys(cc.phones);
        if (ids.length >= 3) {
          ids.sort(function(a, b) { return cc.phones[a].at - cc.phones[b].at; });
          delete cc.phones[ids[0]];
        }
        var key = hex(16);
        cc.phones[st.pid] = { key: key, name: ("" + (m.name || "iPhone")).substr(0, 20), at: Date.now() };
        exports.saveCfg(cc);
        st.auth = 1;
        send(st, { t: "paired", key: key, watch: cc.wid, q: q });
      });
      return;
    case "auth":
      c = exports.cfg();
      var ph = st.pid && c.phones[st.pid];
      var nonce = st.nonce;
      st.nonce = undefined; // single use
      if (!ph || !nonce) return err("auth_failed", "auth");
      if (m.proof !== sha256hex(ph.key + ":" + nonce + ":" + st.pid)) return err("auth_failed", "auth");
      st.auth = 1;
      return { t: "authok" };
  }
  if (!st.auth) return err("unauthorized", m.t);

  switch (m.t) {
    case "time":
      if (typeof m.ms == "number" && m.ms > 1.6E12) setTime(m.ms / 1000);
      if (typeof m.tz == "number" && Math.abs(m.tz) <= 14 * 60) {
        var tzh = m.tz / 60;
        E.setTimeZone(tzh);
        // Persist so the next boot keeps it. Only write when it changed:
        // setting.json is part of the bootloader's boot0 checksum.
        var s = S.readJSON("setting.json", 1) || {};
        if (s.timezone !== tzh) { s.timezone = tzh; S.writeJSON("setting.json", s); }
      }
      return { t: "ok", re: "time", now: Date.now() };
    case "status":
      c = exports.cfg();
      var ses = exports.readSes(), w = S.readJSON(F.wkt, 1), pc = exports.pendCount();
      return {
        t: "st", pend: pc.n, pendSets: pc.sets,
        ses: ses ? { sid: ses.sid, wn: ses.wn, xi: ses.xi, sn: ses.sn, n: (ses.recs || []).length, start: ses.start } : null,
        wkt: w ? { id: w.id, rev: w.rev || 0, name: w.name } : null,
        sAck: c.sAck || 0, bat: E.getBattery ? E.getBattery() : null,
        free: S.getFree ? S.getFree() : null, now: Date.now(), sl: sleeplogInfo()
      };
    case "wput":
      if (!validWorkout(m.w)) return err("bad_workout", "wput");
      S.writeJSON(F.wkt, m.w);
      var back = S.readJSON(F.wkt, 1); // durable before we acknowledge
      if (!back || back.id !== m.w.id) return err("write_failed", "wput");
      if (E.emit) E.emit("nsync", "wkt");
      return { t: "wack", id: back.id, rev: back.rev || 0 };
    case "pull":
      var p = exports.pend();
      var all = Object.keys(p).map(function(k) { return p[k]; });
      all.sort(function(a, b) { return (a.at - b.at) || (a.id < b.id ? -1 : 1); });
      var max = Math.max(1, Math.min(20, m.max | 0 || 8));
      return { t: "recs", recs: all.slice(0, max), more: all.length > max, total: all.length };
    case "ack":
      if (!Array.isArray(m.ids)) return err("bad_ack", "ack");
      var pa = exports.pend(), n = 0;
      m.ids.forEach(function(e) {
        var r = Array.isArray(e) ? pa[e[0]] : undefined;
        if (r && r.rev <= e[1]) { delete pa[e[0]]; n++; }
      });
      if (n) writeDual(F.pend, pa);
      c = exports.cfg();
      c.lastSync = Date.now();
      exports.saveCfg(c);
      if (E.emit) E.emit("nsync", "pend");
      return { t: "acked", n: n, left: Object.keys(pa).length };
    case "sleep":
      if (!S.read("sleeplog")) return err("no_sleeplog", "sleep");
      var since = Math.max(0, m.since | 0);
      var lmax = Math.max(10, Math.min(300, m.max | 0 || 150));
      var log = require("sleeplog").readLog(since * 6E5, Date.now());
      if (Modules.getCached().indexOf("sleeplog") >= 0) Modules.removeCached("sleeplog");
      var page = log.slice(0, lmax);
      return {
        t: "slp", since: since, now: (Date.now() / 6E5) | 0, entries: page,
        more: log.length > lmax, sl: sleeplogInfo()
      };
    case "sack":
      c = exports.cfg();
      if ((m.upto | 0) > (c.sAck || 0)) { c.sAck = m.upto | 0; exports.saveCfg(c); }
      return { t: "ok", re: "sack" };
    case "unpair":
      c = exports.cfg();
      delete c.phones[st.pid];
      exports.saveCfg(c);
      st.auth = 0;
      return { t: "ok", re: "unpair" };
  }
  return err("unknown", m.t);
}
exports.handle = handle;

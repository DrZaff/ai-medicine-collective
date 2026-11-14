/* NextSet Sync - Bangle.js 2 workout app (nsync.app.js).
 *
 * Screens
 *   Main menu   Start/Resume, pending count, Pair phone, Sync info
 *   Set entry   [ LOAD ][ REPS ][ RIR ]  tap a box to select it,
 *               [  -   ][  +   ][ LOG ]  drag up/down on a box for fast changes
 *               Button: session menu (rest, edit sets, skip, finish)
 *   Rest        big countdown, [-15][+30][SKIP], vibrates at zero
 *
 * Everything is saved to Storage after each change (nsync.ses.*), and
 * every logged or edited set goes into nsync.pend.* until the iPhone
 * acknowledges it, so a disconnect, app exit or reboot loses nothing.
 */
var S = require("Storage");
var L = require("nsync");
var F = L.F;
global.NSYNC_APP = 1;
var W = g.getWidth(), H = g.getHeight();
var ses = L.readSes();
var screen = "", sel = 0, draft = null, editing = null, timer;
var lastUnlock = 0;

// Longer lock/backlight while lifting; restored on exit.
var savedOpts = Bangle.getOptions ? Bangle.getOptions() : null;
Bangle.setOptions({ lockTimeout: 30000, backlightTimeout: 15000 });
Bangle.on("lock", function(locked) { if (!locked) lastUnlock = Date.now(); });

function save() { if (ses) L.writeSes(ses); }
E.on("kill", function() {
  save();
  if (savedOpts) Bangle.setOptions({ lockTimeout: savedOpts.lockTimeout, backlightTimeout: savedOpts.backlightTimeout });
  delete global.NSYNC_PAIR;
  delete global.NSYNC_APP;
});

function font(name) { try { g.setFont(name); } catch (e) { g.setFont("6x8", 2); } }
function fit(str, w, f) {
  font(f);
  str = "" + str;
  if (g.stringWidth(str) <= w) return str;
  while (str.length > 1 && g.stringWidth(str + ".") > w) str = str.substr(0, str.length - 1);
  return str + ".";
}
function short(s) { return ("" + s).length > 14 ? ("" + s).substr(0, 13) + "." : "" + s; }
function num(v) { return Math.round(v) == v ? "" + v : v.toFixed(1); }
function clearTimer() { if (timer) clearInterval(timer); timer = undefined; }
function hhmm() { var d = new Date(); return ("0" + d.getHours()).substr(-2) + ":" + ("0" + d.getMinutes()).substr(-2); }

// ---- session model -------------------------------------------------------
function curEx() { return ses.ex[ses.xi]; }
function step(ex) { return ex.inc || (ses.units == "kg" ? 2.5 : 5); }
function lowReps(r) { var m = /(\d+)/.exec("" + r); return m ? parseInt(m[1], 10) : 8; }
function liveSets(xi) {
  return (ses.recs || []).filter(function(r) { return r.xi == xi && !r.del; });
}
function ghost(ex) {
  var previous = ses.ghost && ses.ghost[ex.id];
  return previous && previous.units == ses.units ? previous : null;
}
function matchesGhost(previous, rec) {
  return previous && rec.rir === previous.rir &&
    rec.load >= previous.load && rec.reps >= previous.reps;
}
function defaults(ex) {
  var prev = liveSets(ses.xi);
  if (prev.length) { var p = prev[prev.length - 1]; return { load: p.load, reps: p.reps, rir: p.rir }; }
  var last = (S.readJSON(F.last, 1) || {})[ex.id];
  return {
    load: last && last.units == ses.units ? last.load : (ex.load || 0),
    reps: last && last.units == ses.units ? last.reps : lowReps(ex.reps),
    rir: ex.rir !== undefined ? ex.rir : 2
  };
}
function startSession() {
  var w = S.readJSON(F.wkt, 1);
  if (!w) return showMain();
  var c = L.cfg();
  var now = Date.now();
  var last = S.readJSON(F.last, 1) || {}, baseline = {};
  w.ex.forEach(function(ex) {
    if (last[ex.id] && last[ex.id].units == (w.units || "lb")) baseline[ex.id] = last[ex.id];
  });
  ses = {
    sid: c.wid + "-" + Math.floor(now / 1000).toString(36),
    wid: w.id, wn: w.name, units: w.units || "lb", ex: w.ex,
    xi: 0, sn: 1, start: now, restEnd: 0, recs: [],
    ghost: baseline
  };
  save();
  showEntry();
}
// The prefill and next session's Ghost come from nsync.last.json. Keep it equal
// to the newest live set of that exercise, so an edited or deleted typo
// (1400 instead of 140) never becomes the next baseline.
function rememberLast(xid) {
  var live = (ses.recs || []).filter(function(r) { return r.xid == xid && !r.del; })
    .sort(function(a, b) { return (a.ed || a.at) - (b.ed || b.at); });
  var last = S.readJSON(F.last, 1) || {};
  var top = live[live.length - 1];
  if (top) last[xid] = { load: top.load, reps: top.reps, rir: top.rir, units: top.units };
  else if (ses.ghost && ses.ghost[xid]) last[xid] = ses.ghost[xid]; // back to the value before this session
  else delete last[xid];
  S.writeJSON(F.last, last);
}
function upsertSesRec(rec) {
  for (var i = 0; i < ses.recs.length; i++) if (ses.recs[i].id == rec.id) { ses.recs[i] = rec; return; }
  ses.recs.push(rec);
}
function logSet() {
  var ex = curEx(), now = Date.now();
  var id = ses.sid + "." + ses.xi + "." + ses.sn;
  var rec = {
    k: "set", id: id, rev: 1, sid: ses.sid, wid: ses.wid, wn: ses.wn,
    xi: ses.xi, xid: ex.id || ("x" + ses.xi), xn: ex.name, set: ses.sn,
    load: draft.load, units: ses.units, reps: draft.reps, rir: draft.rir, at: now
  };
  try { rec = L.putRec(rec); } catch (e) { return E.showAlert("Sync with the iPhone first (" + e.message + ")").then(showEntry); }
  upsertSesRec(rec);
  rememberLast(rec.xid);
  var previous = ghost(ex);
  var firstMatch = matchesGhost(previous, rec) && !liveSets(ses.xi).some(function(r) {
    return r.id != rec.id && matchesGhost(previous, r);
  });
  if (firstMatch) Bangle.buzz(90).then(function() { return Bangle.buzz(140, 0.5); });
  else Bangle.buzz(40);
  var nextLabel;
  if (ses.sn < ex.sets) { ses.sn++; nextLabel = ex.name + " " + ses.sn + "/" + ex.sets; }
  else if (ses.xi < ses.ex.length - 1) { ses.xi++; ses.sn = 1; nextLabel = curEx().name + " 1/" + curEx().sets; }
  else { ses.done = 1; nextLabel = "Finish workout"; }
  draft = null;
  ses.draft = null;
  startRest(ex.rest || 90, nextLabel);
}
function finishSession() {
  var n = (ses.recs || []).filter(function(r) { return !r.del; }).length;
  try {
    L.putRec({ k: "ses", id: ses.sid, rev: 1, sid: ses.sid, wid: ses.wid, wn: ses.wn,
      units: ses.units, start: ses.start, end: Date.now(), n: n, at: Date.now() });
  } catch (e) { return E.showAlert("Sync with the iPhone first").then(showEntry); }
  L.eraseSes();
  ses = null;
  var p = L.pendCount();
  E.showAlert(n + " sets logged.\n" + p.sets + " sets waiting to sync.", "Workout saved").then(showMain);
}

// ---- set entry screen ----------------------------------------------------
var BOX = [{ x: 2, k: "load" }, { x: 60, k: "reps" }, { x: 118, k: "rir" }];
var BY = 46, BH = 64, BW = 56, KY = 116, KH = 58;

function drawEntry() {
  var ex = editing ? ses.ex[editing.xi] : curEx();
  g.reset().clearRect(0, 0, W - 1, H - 1);
  g.setFontAlign(-1, -1);
  g.drawString(fit(editing ? "Edit: " + editing.xn : ex.name, W - 4, "Vector:20"), 2, 2);
  font("6x15");
  // Line 2: the Ghost (last time) when there is one, otherwise the prescription.
  var previous = editing ? null : ghost(ex);
  var line = editing ? "Set " + editing.set : "Set " + ses.sn + "/" + ex.sets + "  " + (previous
    ? "Last " + num(previous.load) + "x" + previous.reps + "@" + previous.rir
    : (ex.reps || "") + (ex.rir !== undefined ? " @" + ex.rir : ""));
  g.drawString(fit(line, W - 44, "6x15"), 2, 26);
  g.setFontAlign(1, -1).drawString(hhmm(), W - 2, 26);
  var labels = [(ses.units || "lb").toUpperCase(), "REPS", "RIR"];
  BOX.forEach(function(b, i) {
    var on = i == sel;
    g.setColor(on ? g.theme.bgH : g.theme.bg).fillRect(b.x, BY, b.x + BW - 1, BY + BH - 1);
    g.setColor(g.theme.fg).drawRect(b.x, BY, b.x + BW - 1, BY + BH - 1);
    g.setColor(on ? g.theme.fgH : g.theme.fg);
    font("6x8"); g.setFontAlign(0, -1).drawString(labels[i], b.x + BW / 2, BY + 4);
    var v = num(draft[b.k]), size = 30;
    g.setFont("Vector", size);
    while (size > 14 && g.stringWidth(v) > BW - 6) { size -= 2; g.setFont("Vector", size); }
    g.setFontAlign(0, 0).drawString(v, b.x + BW / 2, BY + 38);
  });
  var keys = ["-", "+", editing ? "SAVE" : "LOG"];
  keys.forEach(function(k, i) {
    var x = BOX[i].x;
    if (i == 2) g.setColor("#0f0").fillRect(x, KY, x + BW - 1, KY + KH - 1).setColor("#000");
    else g.setColor(g.theme.fg).drawRect(x, KY, x + BW - 1, KY + KH - 1);
    g.setFont("Vector", i == 2 ? 18 : 34).setFontAlign(0, 0).drawString(k, x + BW / 2, KY + KH / 2 + 1);
    g.setColor(g.theme.fg);
  });
}
function bump(dir) {
  var ex = editing ? ses.ex[editing.xi] : curEx();
  var k = BOX[sel].k;
  if (k == "load") draft.load = Math.max(0, Math.min(1500, Math.round((draft.load + dir * step(ex)) * 100) / 100));
  else if (k == "reps") draft.reps = Math.max(0, Math.min(100, draft.reps + dir));
  else draft.rir = Math.max(0, Math.min(10, draft.rir + dir));
  if (!editing) { ses.draft = draft; }
  drawEntry();
}
function commit() {
  if (!editing) return logSet();
  var r = Object.assign({}, editing, { load: draft.load, reps: draft.reps, rir: draft.rir, rev: editing.rev + 1, ed: Date.now() });
  try { r = L.putRec(r); } catch (e) { return E.showAlert("Sync with the iPhone first").then(showEntry); }
  upsertSesRec(r);
  save();
  rememberLast(r.xid);
  editing = null; draft = null;
  Bangle.buzz(40);
  showEntry();
}
function showEntry() {
  clearTimer();
  screen = "entry";
  if (!ses) return showMain();
  if (!editing && ses.restEnd > Date.now()) return showRest();
  if (!editing && ses.done) return askFinish();
  if (!draft) draft = editing ? { load: editing.load, reps: editing.reps, rir: editing.rir } : (ses.draft || defaults(curEx()));
  var dragAcc = 0;
  Bangle.setUI({
    mode: "custom",
    touch: function(_, xy) {
      if (!xy) return;
      if (xy.y >= BY && xy.y < BY + BH) { sel = xy.x < 58 ? 0 : xy.x < 116 ? 1 : 2; drawEntry(); }
      else if (xy.y >= KY - 4) {
        if (xy.x < 58) bump(-1);
        else if (xy.x < 116) bump(1);
        else commit();
      }
    },
    drag: function(e) {
      if (e.y < BY || e.y > BY + BH + 20) return;
      dragAcc += e.dy;
      while (dragAcc <= -16) { dragAcc += 16; bump(1); }
      while (dragAcc >= 16) { dragAcc -= 16; bump(-1); }
      if (!e.b) dragAcc = 0;
    },
    btn: function() {
      if (Date.now() - lastUnlock < 400) return; // that press only unlocked the screen
      if (editing) { editing = null; draft = null; return showSetList(); }
      showSessionMenu();
    },
    remove: clearTimer
  });
  drawEntry();
  timer = setInterval(function() { if (screen == "entry") { g.reset(); font("6x15"); g.setFontAlign(1, -1).clearRect(W - 42, 26, W - 1, 41).drawString(hhmm(), W - 2, 26); } }, 30000);
}

// ---- rest timer ----------------------------------------------------------
// The end-of-rest buzz is a Scheduler alarm, so it still fires if you leave the
// app or it is closed; without the Scheduler the countdown below buzzes.
function scheduleRest() {
  ses.restAlarm = L.setAlarm("nsync.rest", ses.restEnd - Date.now(), "- -");
}
function startRest(sec, nextLabel) {
  ses.restEnd = Date.now() + sec * 1000;
  scheduleRest();
  ses.restTotal = sec;
  ses.restNext = nextLabel;
  save();
  showRest();
}
function drawRest() {
  var left = Math.max(0, Math.ceil((ses.restEnd - Date.now()) / 1000));
  g.reset().clearRect(0, 0, W - 1, KY - 2);
  font("6x15"); g.setFontAlign(0, -1).drawString("REST", W / 2, 4);
  g.setFont("Vector", 56).setFontAlign(0, 0).drawString(Math.floor(left / 60) + ":" + ("0" + left % 60).substr(-2), W / 2, 56);
  g.drawString(fit("Next: " + (ses.restNext || ""), W - 4, "6x15"), W / 2, 96);
  return left;
}
function endRest(skipped) {
  clearTimer();
  var scheduled = ses.restAlarm;
  if (skipped) L.cancelAlarm("nsync.rest");
  ses.restEnd = 0; ses.restAlarm = false;
  save();
  if (!skipped) {
    Bangle.setLCDPower(1);
    if (Bangle.setLocked) Bangle.setLocked(false);
    if (!scheduled) L.buzz("- -"); // the Scheduler alarm buzzes otherwise
  }
  showEntry();
}
function showRest() {
  clearTimer();
  screen = "rest";
  g.reset().clearRect(0, 0, W - 1, H - 1);
  ["-15", "+30", "SKIP"].forEach(function(k, i) {
    var x = BOX[i].x;
    g.setColor(g.theme.fg).drawRect(x, KY, x + BW - 1, KY + KH - 1);
    g.setFont("Vector", 18).setFontAlign(0, 0).drawString(k, x + BW / 2, KY + KH / 2 + 1);
  });
  Bangle.setUI({
    mode: "custom",
    touch: function(_, xy) {
      if (!xy || xy.y < KY - 4) return;
      if (xy.x < 58) { ses.restEnd = Math.max(Date.now() + 1000, ses.restEnd - 15000); scheduleRest(); save(); drawRest(); }
      else if (xy.x < 116) { ses.restEnd += 30000; scheduleRest(); save(); drawRest(); }
      else endRest(true);
    },
    btn: function() { if (Date.now() - lastUnlock < 400) return; endRest(true); },
    remove: clearTimer
  });
  if (drawRest() <= 0) return endRest(false);
  timer = setInterval(function() { if (drawRest() <= 0) endRest(false); }, 1000);
}

// ---- menus ---------------------------------------------------------------
function showSessionMenu() {
  clearTimer();
  screen = "menu";
  Bangle.setUI();
  var ex = curEx();
  var m = { "": { title: short(ex.name), back: showEntry } };
  m["Rest " + (ex.rest || 90) + "s"] = function() { startRest(ex.rest || 90, ex.name + " " + ses.sn + "/" + ex.sets); };
  m["Edit logged sets"] = showSetList;
  m["Extra set"] = function() { ses.sn = liveSets(ses.xi).length + 1; if (ses.sn > ex.sets) ex.sets = ses.sn; draft = null; save(); showEntry(); };
  if (ses.xi < ses.ex.length - 1) m["Next exercise"] = function() { ses.xi++; ses.sn = liveSets(ses.xi).length + 1; ses.draft = null; draft = null; save(); showEntry(); };
  if (ses.xi > 0) m["Prev exercise"] = function() { ses.xi--; ses.sn = liveSets(ses.xi).length + 1; ses.draft = null; draft = null; save(); showEntry(); };
  m["Finish workout"] = askFinish;
  m["Main menu"] = function() { save(); showMain(); };
  E.showMenu(m);
}
function askFinish() {
  clearTimer();
  screen = "menu";
  Bangle.setUI();
  E.showPrompt("Finish " + short(ses.wn) + "?", { title: "Workout", buttons: { "Finish": 1, "Not yet": 0 } }).then(function(ok) {
    if (ok) return finishSession();
    if (ses.done) { ses.done = 0; ses.sn = liveSets(ses.xi).length + 1; if (ses.sn > curEx().sets) curEx().sets = ses.sn; save(); }
    showEntry();
  });
}
function showSetList() {
  clearTimer();
  screen = "menu";
  Bangle.setUI();
  var m = { "": { title: "Logged sets", back: showSessionMenu } };
  var recs = (ses.recs || []).filter(function(r) { return !r.del; });
  if (!recs.length) m["None yet"] = showSessionMenu;
  recs.slice().reverse().forEach(function(r) {
    m[short(r.xn).substr(0, 9) + " " + r.set + ": " + num(r.load) + "x" + r.reps + " @" + r.rir] = function() { setActions(r); };
  });
  E.showMenu(m);
}
function setActions(r) {
  E.showMenu({
    "": { title: "Set " + r.set, back: showSetList },
    "Edit": function() { editing = r; draft = null; sel = 0; showEntry(); },
    "Delete": function() {
      E.showPrompt("Delete this set?", { buttons: { "Delete": 1, "Keep": 0 } }).then(function(ok) {
        if (ok) {
          try {
            var d = L.putRec(Object.assign({}, r, { del: 1, rev: r.rev + 1, ed: Date.now() }));
            upsertSesRec(d); save(); rememberLast(d.xid);
          } catch (e) { E.showAlert("Sync with the iPhone first"); }
        }
        showSetList();
      });
    }
  });
}
function showPair() {
  clearTimer();
  screen = "pair";
  Bangle.setUI();
  var give = setTimeout(function() { delete global.NSYNC_PAIR; showMain(); }, 120000);
  function cancel() { clearTimeout(give); delete global.NSYNC_PAIR; showMain(); }
  // Plain instructions (not menu rows that look tappable); the button cancels.
  E.showMessage("On the iPhone:\nNextSet Sync >\nWatch > Pair Watch\n\nWaiting 2 min...\n(button: cancel)", "Pair phone");
  Bangle.setUI({ mode: "custom", btn: function() { if (Date.now() - lastUnlock >= 400) cancel(); } });
  global.NSYNC_PAIR = function(name, code, cb) {
    clearTimeout(give);
    delete global.NSYNC_PAIR;
    Bangle.setLCDPower(1);
    Bangle.buzz(200);
    E.showPrompt("Pair " + name + "?\nCode on iPhone:\n" + code, { title: "Pair phone", buttons: { "Pair": 1, "No": 0 } }).then(function(ok) {
      cb(!!ok);
      E.showAlert(ok ? "Paired with " + name : "Not paired").then(showMain);
    });
  };
}
function showSyncInfo() {
  screen = "menu";
  var c = L.cfg(), p = L.pendCount(), sl = L.sleeplogInfo();
  var conn = NRF.getSecurityStatus ? NRF.getSecurityStatus().connected : false;
  var m = { "": { title: "Sync", back: showMain } };
  m["Waiting: " + p.sets + (p.sets == 1 ? " set" : " sets")] = function() {};
  m["Other records: " + (p.n - p.sets)] = function() {};
  m["Phone: " + (conn ? "connected" : "not connected")] = function() {};
  m["Last sync: " + (c.lastSync ? require("locale").time(new Date(c.lastSync), 1) : "never")] = function() {};
  m["Sleep Log: " + (sl.ver ? sl.ver + (sl.on ? "" : " (off)") : "missing")] = function() {};
  m["Markers to sync: " + L.markCount().unsynced] = function() {};
  m["Storage free: " + Math.round((S.getFree ? S.getFree() : 0) / 1024) + " KB"] = function() {};
  m["Scheduler: " + (S.read("sched") ? "yes" : "missing")] = function() {};
  m["App " + L.VERSION + " fw " + process.env.VERSION] = function() {};
  m["Watch ID " + c.wid] = function() {};
  m["Paired phones: " + Object.keys(c.phones).length] = function() {};
  if (Object.keys(c.phones).length) m["Forget phones"] = function() {
    E.showPrompt("Forget all paired phones?").then(function(ok) {
      if (ok) { c.phones = {}; L.saveCfg(c); }
      showSyncInfo();
    });
  };
  E.showMenu(m);
}
// Morning check-in: one tap, synced to the iPhone beside last night's sleep and resting heart rate.
function showCheckin() {
  screen = "menu";
  var m = { "": { title: "How do you feel?", back: showMain } };
  [[5, "Great"], [4, "Good"], [3, "OK"], [2, "Tired"], [1, "Wrecked"]].forEach(function(o) {
    m[o[0] + "  " + o[1]] = function() {
      try { L.addCheckin(o[0]); } catch (e) { return E.showAlert(e.message, "Not saved").then(showMain); }
      Bangle.buzz(40);
      E.showAlert("Saved: " + o[1] + "\nSyncs with your sleep", "Check-in").then(showMain);
    };
  });
  E.showMenu(m);
}
function showSelfTest() {
  screen = "menu";
  var r = L.selfTest(), bad = r.filter(function(c) { return c.s != "ok"; }).length;
  var m = { "": { title: bad ? bad + " to check" : "All good", back: showMain } };
  var mark = { ok: "OK ", warn: "!! ", fail: "XX " };
  r.forEach(function(c) {
    m[mark[c.s] + c.n] = function() { if (c.d) E.showAlert(c.d, c.n).then(showSelfTest); };
  });
  E.showMenu(m);
}
function showMain() {
  clearTimer();
  screen = "main";
  Bangle.setUI();
  var w = S.readJSON(F.wkt, 1), p = L.pendCount();
  var m = { "": { title: "NextSet Sync", back: function() { load(); } } };
  if (ses) m["Resume " + short(ses.wn)] = showEntry;
  else if (w) m["Start " + short(w.name)] = startSession;
  else m["No workout yet"] = function() { E.showAlert("Send a workout from the iPhone app.").then(showMain); };
  m[(p.sets ? p.sets + (p.sets == 1 ? " set" : " sets") + " to sync" : "All synced")] = showSyncInfo;
  m["Pair phone"] = showPair;
  m["Check-in"] = showCheckin;
  m["Self-test"] = showSelfTest;
  m["Timers"] = function() { require("nsync-tools").open(showMain); };
  m["Mark a moment"] = function() { require("nsync-tools").markers(showMain); };
  m["Retro progress"] = function() { require("nsync-tools").progress(showMain); };
  E.showMenu(m);
}

// The phone can deliver a workout or acknowledge sets while we are open.
E.on("nsync", function() { if (screen == "main") showMain(); });

g.clear();
if (ses) showEntry(); else showMain();

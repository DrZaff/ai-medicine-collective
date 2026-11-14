/* NextSet Sync watch tools (Storage module "nsync-tools"), loaded only when opened.
 *
 * Silent timers: the deadline is saved (nsync.timer.json) and the 1-minute
 * warning and end buzzes are Scheduler alarms, so a timer survives a button
 * press, leaving the app, a notification or a restart. The button goes back to
 * the menu and the timer keeps running; ending it asks first.
 * Stopwatch: state saved (nsync.sw.json), so it keeps counting off-screen.
 * Markers: crash-safe records with stable ids (lib.js addMark), synced to the
 * iPhone like sets.
 * Screens redraw only while the LCD is on.
 */
var S = require("Storage");
var L = require("nsync");
var TIMER = "nsync.timer.json", SW = "nsync.sw.json";
var tick, backToApp, lastUnlock = 0;
var screenGen = 0; // bumped on every navigation, so a delayed redraw never yanks you back
function leave() { screenGen++; stopTick(); backToApp(); }

Bangle.on("lock", function(locked) { if (!locked) lastUnlock = Date.now(); });
function justUnlocked() { return Date.now() - lastUnlock < 400; } // that press only woke the screen
function stopTick() { if (tick !== undefined) clearInterval(tick); tick = undefined; }
function every(ms, fn) {
  stopTick();
  fn();
  tick = setInterval(function() { if (!Bangle.isLCDOn || Bangle.isLCDOn()) fn(); }, ms);
}
function clock(ms, tenths) {
  var t = Math.max(0, ms), seconds = Math.floor(t / 1000);
  return Math.floor(seconds / 60) + ":" + ("0" + seconds % 60).substr(-2) + (tenths ? "." + Math.floor(t / 100) % 10 : "");
}
function display(title, value, left, right, note) {
  g.reset().clearRect(0, 0, 175, 175);
  g.setFont("6x15").setFontAlign(0, 0).drawString(title, 88, 22);
  g.setFont("Vector", 34).drawString(value, 88, 72);
  if (note) g.setFont("6x15").drawString(note, 88, 100);
  g.setFont("6x15").drawRect(1, 116, 86, 174).drawRect(89, 116, 174, 174);
  g.drawString(left, 44, 146).drawString(right, 132, 146);
}
function ui(touch, back) {
  Bangle.setUI({ mode: "custom", touch: function(_, xy) {
    if (xy && xy.y >= 116) touch(xy.x < 88);
  }, btn: function() { if (!justUnlocked()) back(); }, remove: stopTick });
}

// ---- silent timers -------------------------------------------------------------
function running() {
  var t = S.readJSON(TIMER, 1);
  return t && t.end > Date.now() ? t : null;
}
function startTimer(title, minutes) {
  var now = Date.now(), t = { title: title, end: now + minutes * 60000 };
  S.writeJSON(TIMER, t);
  schedule(t);
  showTimer();
}
function schedule(t) {
  var left = t.end - Date.now();
  t.alarms = L.setAlarm("nsync.timer", left, "- - -");
  if (left > 90000) L.setAlarm("nsync.warn", left - 60000, ".");
  else L.cancelAlarm("nsync.warn");
  S.writeJSON(TIMER, t);
}
function endTimer() {
  L.cancelAlarm("nsync.timer"); L.cancelAlarm("nsync.warn");
  S.erase(TIMER);
}
function showTimer() {
  E.showMenu();
  var t = S.readJSON(TIMER, 1);
  if (!t) return showMenu();
  var warned = t.end - Date.now() <= 60000;
  function draw() {
    var left = t.end - Date.now();
    if (left <= 0) {
      stopTick();
      if (!t.alarms) L.buzz("- - -"); // no Scheduler: buzz from here
      S.erase(TIMER);
      display(t.title, "0:00", "Done", "Done");
      return;
    }
    if (!t.alarms && !warned && left <= 60000) { warned = true; L.buzz("."); }
    display(t.title, clock(Math.ceil(left / 1000) * 1000), "+1 min", "End", t.alarms ? "" : "keep this screen open");
  }
  ui(function(isLeft) {
    if (!running()) return showMenu();
    if (isLeft) { t.end += 60000; schedule(t); draw(); return; }
    E.showPrompt("End " + t.title + "?", { buttons: { "End": 1, "Keep": 0 } }).then(function(ok) {
      if (ok) { endTimer(); showMenu(); } else showTimer();
    });
  }, showMenu);
  every(1000, draw);
}

// ---- stopwatch -----------------------------------------------------------------
function swState() { return S.readJSON(SW, 1) || { started: null, elapsed: 0, laps: [] }; }
function stopwatch() {
  E.showMenu();
  var sw = swState();
  function time() { return sw.elapsed + (sw.started === null ? 0 : Date.now() - sw.started); }
  function draw() {
    var lap = sw.laps.length ? "Lap " + sw.laps.length + "  " + clock(sw.laps[sw.laps.length - 1], true) : "";
    display("Stopwatch", clock(time(), true), sw.started === null ? "Start" : "Pause",
      sw.started === null ? "Reset" : "Lap", lap);
  }
  ui(function(isLeft) {
    if (isLeft && sw.started === null) sw.started = Date.now();
    else if (isLeft) { sw.elapsed = time(); sw.started = null; }
    else if (sw.started === null) { sw.elapsed = 0; sw.laps = []; }
    else if (sw.laps.length < 99) sw.laps.push(time());
    S.writeJSON(SW, sw);
    draw();
  }, showMenu);
  every(200, draw);
}

// ---- markers ---------------------------------------------------------------------
var LABELS = ["Coffee", "Headache", "Workout note", "Idea", "Felt great", "Low energy"];
function mark(label) {
  try { L.addMark(label); } catch (e) {
    return E.showAlert(e.message || "Marker could not be saved", "Not saved").then(showMarkers);
  }
  Bangle.buzz(40);
  E.showMessage(label + "\nmarked " + ("0" + new Date().getHours()).substr(-2) + ":" + ("0" + new Date().getMinutes()).substr(-2));
  var my = ++screenGen;
  setTimeout(function() { if (screenGen == my) showMarkers(); }, 900);
}
function showMarkers() {
  stopTick(); screenGen++;
  var m = { "": { title: "Mark a moment", back: leave } };
  LABELS.forEach(function(label) { m[label] = function() { mark(label); }; });
  m["Recent markers"] = function() {
    var all = L.marks(), ids = Object.keys(all).sort(function(a, b) { return all[b].at - all[a].at; }).slice(0, 8);
    var r = { "": { title: "Recent", back: showMarkers } };
    ids.forEach(function(id) {
      var e = all[id], d = new Date(e.at);
      r[("0" + d.getHours()).substr(-2) + ":" + ("0" + d.getMinutes()).substr(-2) + " " + e.label + (e.synced ? "" : " *")] = function() {};
    });
    if (!ids.length) r["No markers yet"] = function() {};
    else r["* = not synced yet"] = function() {};
    E.showMenu(r);
  };
  E.showMenu(m);
}

// ---- retro status ------------------------------------------------------------------
function progress() {
  E.showMenu();
  function draw() {
    var now = new Date(), pending = L.pendCount(), t = running();
    var steps = Bangle.getHealthStatus ? Bangle.getHealthStatus("day").steps : 0;
    var time = ("0" + now.getHours()).substr(-2) + ":" + ("0" + now.getMinutes()).substr(-2);
    g.reset().setColor("#102").fillRect(0, 0, 175, 175);
    g.setColor("#ff8").setFont("Vector", 42).setFontAlign(0, 0).drawString(time, 88, 46);
    g.setColor("#0ff").setFont("6x15").drawString(steps + " STEPS", 88, 92);
    g.setColor("#faf").drawString(pending.sets ? pending.sets + (pending.sets == 1 ? " SET" : " SETS") + " TO SYNC" : "ALL SYNCED", 88, 116);
    if (t) g.setColor("#ff0").drawString(t.title + " " + clock(t.end - Date.now()), 88, 140);
  }
  Bangle.setUI({ mode: "custom", btn: function() { if (!justUnlocked()) leave(); }, remove: stopTick });
  every(5000, draw);
}

// ---- menu ----------------------------------------------------------------------------
function showMenu() {
  stopTick(); screenGen++;
  var m = { "": { title: "Timers", back: leave } }, t = running();
  if (t) m["> " + t.title + " " + clock(t.end - Date.now())] = showTimer;
  [["Chalk talk", 5], ["Presentation", 10], ["Focus", 25], ["Stretch", 2]].forEach(function(p) {
    m[p[0] + " (" + p[1] + "m)"] = function() {
      if (!running()) return startTimer(p[0], p[1]);
      E.showPrompt("Replace the running timer?", { buttons: { "Replace": 1, "Keep": 0 } }).then(function(ok) {
        if (ok) { endTimer(); startTimer(p[0], p[1]); } else showMenu();
      });
    };
  });
  m["Stopwatch"] = stopwatch;
  E.showMenu(m);
}
exports.open = function(back) { backToApp = back; if (running()) showTimer(); else showMenu(); };
exports.markers = function(back) { backToApp = back; showMarkers(); };
exports.progress = function(back) { backToApp = back; progress(); };

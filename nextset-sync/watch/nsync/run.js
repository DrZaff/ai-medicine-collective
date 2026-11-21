/* NextSet Sync Run / Walk (Storage module "nsync-run"), loaded only when opened.
 *
 * Outdoor run or walk with the Bangle's own GPS, no phone needed. Distance,
 * pace, splits and the rules for bad GPS are in gps.js ("nsync-gps").
 *
 *   Before Start  GPS warms up; START (bottom half). Button: back (GPS off).
 *   Moving        live pace largest, distance and elapsed below, moving time.
 *                 Button: pause. A mile (or km) buzzes once and shows the
 *                 split for 5 s.
 *   Paused        RESUME | FINISH. Button: resume.
 *   Finish        SAVE | DISCARD (discard asks first).
 *
 * Saved every 30 s, at each split and on every control (nsync.run.a/b.json),
 * and the route is appended to nsync.rt<start> as you go, so a crash or
 * restart loses at most 30 s. Leaving the app pauses the run (the GPS is
 * released); opening it again shows it paused. On Save the summary joins the
 * records that sync to the iPhone; the route is sent with it and erased once
 * the iPhone has stored both. The GPS is switched off on Save, Discard, back
 * and leaving the app.
 */
var S = require("Storage");
var L = require("nsync");
var G = require("nsync-gps");
var CFG = "nsync.runcfg.json";
var r = null, back, tick, mode, lastUnlock = 0, overlay = null, sats = 0, gpsOn = false, preFix = 0;

function cfg() {
  var c = S.readJSON(CFG, 1) || {};
  return { units: c.units == "km" ? "km" : "mi", run: c.run === undefined ? true : !!c.run, walk: !!c.walk };
}
function gps(on) {
  if (on == gpsOn) return;
  gpsOn = on;
  if (Bangle.setGPSPower) Bangle.setGPSPower(on ? 1 : 0, "nsync");
}
function save() { r.saved = Date.now(); L.writeDual(L.F.run, r); }
function justUnlocked() { return Date.now() - lastUnlock < 400; }
function stopTick() { if (tick) clearInterval(tick); tick = undefined; }
function every(fn) {
  stopTick();
  fn();
  tick = setInterval(function() { if (!Bangle.isLCDOn || Bangle.isLCDOn()) fn(); }, 1000);
}
function distText(m, u) { var v = m / G.unitM(u); return v < 10 ? v.toFixed(2) : v.toFixed(1); }
function name() { return (r ? r.mode : mode) == "walk" ? "WALK" : "RUN"; }

function writePt(pt) {
  if (S.getFree && S.getFree() < L.MIN_FREE) { r.n--; r.rtFull = 1; return; } // keep sets loggable; distance still counts
  S.open(L.routeFile(r.start), "a").write(pt.join(",") + "\n");
}
function onGPS(f) {
  sats = f.satellites | 0;
  if (f.fix) preFix = Date.now();
  if (!r || r.fin) return;
  var now = Date.now(), o = G.onFix(r, f, now);
  if (o.pt) writePt(o.pt);
  if (o.split) {
    save();
    if (r.buzz) { overlay = { n: o.split.n, s: o.split.s, until: now + 5000 }; L.buzz("- -"); }
    if (screen == "live") drawLive();
  } else if (now - (r.saved || 0) > 30000) save();
}
Bangle.on("GPS", onGPS);
Bangle.on("lcdPower", function(on) { if (on && r && screen == "live") drawLive(); }); // fresh numbers the moment you look
Bangle.on("lock", function(locked) { if (!locked) lastUnlock = Date.now(); });
E.on("kill", function() {
  if (r && !r.fin) { G.pause(r, Date.now()); save(); }
  gps(false);
});

var screen = "";
function ui(o) { Bangle.setUI(Object.assign({ mode: "custom", remove: stopTick }, o)); }
function buttons(left, right) {
  g.setFont("Vector", 18).setFontAlign(0, 0).drawRect(1, 116, 86, 174).drawRect(89, 116, 174, 174);
  g.drawString(left, 44, 146).drawString(right, 132, 146);
}
function leave() {
  stopTick();
  gps(false);
  Bangle.setUI();
  screen = "";
  back();
}

// ---- before Start ----------------------------------------------------------------
function showStart() {
  screen = "start";
  gps(true);
  every(function() {
    var ready = preFix && Date.now() - preFix < 5000;
    g.reset().clearRect(0, 0, 175, 175).setFontAlign(0, 0);
    g.setFont("Vector", 30).drawString(name(), 88, 26);
    g.setFont("6x15").drawString(ready ? "GPS ready" : "Searching for GPS", 88, 62);
    g.drawString(ready ? "Start when you are" : sats + " satellites. Stay outside;", 88, 80);
    if (!ready) g.drawString("you can start anyway", 88, 96);
    g.setFont("Vector", 30).drawRect(1, 116, 174, 174).drawString("START", 88, 146);
  });
  ui({ touch: function(_, xy) { if (xy && xy.y >= 116) start(); },
    btn: function() { if (!justUnlocked()) leave(); } });
}
function start() {
  if (L.actCount() >= L.MAX_ACTS) return E.showAlert("Sync with the iPhone first: " + L.MAX_ACTS + " runs are waiting.").then(showStart);
  if (S.getFree && S.getFree() < L.MIN_FREE + 20000) return E.showAlert("Storage is low.\nSync with the iPhone first.").then(showStart);
  var c = cfg();
  r = G.create(mode, c.units, c[mode], Date.now());
  save();
  L.buzz(".");
  showLive();
}

// ---- moving ---------------------------------------------------------------------
function drawLive() {
  var now = Date.now(), st = G.status(r, now), u = r.units;
  g.reset().clearRect(0, 0, 175, 175);
  g.setFont("6x15").setFontAlign(-1, -1).drawString(name(), 4, 3);
  g.setFontAlign(1, -1).drawString(st == "ok" ? "GPS" : st == "lost" ? "GPS LOST" : "GPS searching", 172, 3);
  g.setFontAlign(0, 0);
  if (overlay && now < overlay.until) {
    g.setFont("Vector", 26).drawString((u == "km" ? "KM " : "MILE ") + overlay.n, 88, 36);
    g.setFont("Vector", 46).drawString(G.clock(overlay.s), 88, 78);
  } else {
    overlay = null;
    g.setFont("Vector", 58).drawString(G.clock(G.pace(r, now)), 88, 56);
    g.setFont("6x15").drawString(st == "ok" ? "min/" + u : "pace needs GPS", 88, 96);
  }
  g.drawLine(0, 108, 175, 108);
  g.setFont("Vector", 30).setFontAlign(-1, 0).drawString(distText(r.dist, u), 4, 132);
  g.setFont("6x15").drawString(u, 6, 156);
  g.setFont("Vector", 30).setFontAlign(1, 0).drawString(G.clock((now - r.start) / 1000), 172, 132);
  g.setFont("6x15").drawString("moving " + G.clock(G.moving(r, now) / 1000), 172, 156);
}
function showLive() {
  screen = "live";
  gps(true);
  every(drawLive);
  ui({ btn: function() { if (!justUnlocked()) pause(); } });
}
function pause() {
  G.pause(r, Date.now());
  save();
  L.buzz(".");
  showPaused();
}

// ---- paused ---------------------------------------------------------------------
function showPaused() {
  screen = "paused";
  gps(true); // keep the fix warm for Resume
  every(function() {
    var now = Date.now();
    g.reset().clearRect(0, 0, 175, 175).setFontAlign(0, 0);
    g.setFont("Vector", 26).drawString("PAUSED", 88, 18);
    g.setFont("Vector", 36).drawString(distText(r.dist, r.units) + " " + r.units, 88, 58);
    g.setFont("6x15").drawString("moving " + G.clock(G.moving(r, now) / 1000) + "  total " + G.clock((now - r.start) / 1000), 88, 92);
    buttons("RESUME", "FINISH");
  });
  ui({ touch: function(_, xy) {
    if (!xy || xy.y < 116) return;
    if (xy.x < 88) { G.resume(r, Date.now()); save(); L.buzz("."); showLive(); }
    else { r.fin = Date.now(); save(); showFinish(); }
  }, btn: function() { if (!justUnlocked()) { G.resume(r, Date.now()); save(); showLive(); } } });
}

// ---- finish ------------------------------------------------------------------------
function showFinish() {
  screen = "finish";
  gps(false);
  var sum = G.summary(r, r.fin);
  stopTick();
  g.reset().clearRect(0, 0, 175, 175).setFontAlign(0, 0);
  g.setFont("Vector", 20).drawString("Save this " + (r.mode == "walk" ? "walk?" : "run?"), 88, 18);
  g.setFont("Vector", 30).drawString(distText(sum.dist, r.units) + " " + r.units, 88, 52);
  var avg = sum.dist > 10 ? sum.mov * G.unitM(r.units) / sum.dist : null;
  g.setFont("6x15").drawString("moving " + G.clock(sum.mov) + "  avg " + G.clock(avg) + "/" + r.units, 88, 84);
  if (r.rtFull) g.drawString("Route cut short: storage low", 88, 102);
  buttons("SAVE", "DISCARD");
  ui({ touch: function(_, xy) {
    if (!xy || xy.y < 116) return;
    if (xy.x < 88) saveRun();
    else E.showPrompt("Discard this " + (r.mode == "walk" ? "walk" : "run") + "?\nIts route is deleted.", { title: "Discard" })
      .then(function(yes) { if (yes) discard(); else showFinish(); });
  }, btn: function() { if (!justUnlocked()) { delete r.fin; save(); showPaused(); } } });
}
function saveRun() {
  var sum = G.summary(r, r.fin);
  if (r.rtFull) sum.cut = 1;
  L.addAct(sum);      // 1. the record that syncs (same id if this runs twice)
  L.eraseDual(L.F.run); // 2. then forget the run in progress
  r = null;
  gps(false);
  E.showAlert("Saved. It syncs to your iPhone.", name()).then(leave);
}
function discard() {
  S.open(L.routeFile(r.start), "r").erase();
  L.eraseDual(L.F.run);
  r = null;
  leave();
}

// ---- settings --------------------------------------------------------------------
function settings(backFn) {
  var c = cfg();
  function put() { S.writeJSON(CFG, c); }
  E.showMenu({
    "": { title: "Run & walk", back: backFn },
    "Units": { value: c.units == "km", format: function(v) { return v ? "km" : "miles"; }, onchange: function(v) { c.units = v ? "km" : "mi"; put(); } },
    "Run: buzz each split": { value: c.run, onchange: function(v) { c.run = v; put(); } },
    "Walk: buzz each split": { value: c.walk, onchange: function(v) { c.walk = v; put(); } }
  });
}

// Opens the run or walk in progress (paused), or a new one of `m` ("run"/"walk").
exports.open = function(m, backFn) {
  back = backFn;
  mode = m;
  r = L.readDual(L.F.run) || null;
  if (r) {
    if (!r.paused) G.pause(r, r.saved || Date.now()); // the app stopped while moving: count up to the last save
    save();
    return r.fin ? showFinish() : showPaused();
  }
  showStart();
};
exports.inProgress = function() { return L.readDual(L.F.run) || null; };
exports.settings = settings;
exports.state = function() { return { r: r, screen: screen, gps: gpsOn, overlay: overlay }; };

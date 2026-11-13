/* Standalone stopwatch and silent timer, loaded only when opened. */
var tick;
var deadline = 0, warningAt = 0;
var started = null, elapsed = 0, laps = [];
var backToApp;
var S = require("Storage");
var L = require("nsync");
var markersFile = "nsync.markers.json";

function stopTick() {
  if (tick !== undefined) clearInterval(tick);
  tick = undefined;
}
function clock(ms, tenths) {
  var seconds = Math.floor(Math.max(0, ms) / 1000);
  return Math.floor(seconds / 60) + ":" + ("0" + seconds % 60).substr(-2) +
    (tenths ? "." + Math.floor(Math.max(0, ms) / 100) % 10 : "");
}
function display(title, value, left, right) {
  g.reset().clearRect(0, 0, 175, 175);
  g.setFont("6x15").setFontAlign(0, 0).drawString(title, 88, 22);
  g.setFont("Vector", 34).drawString(value, 88, 72);
  g.setFont("6x15").drawRect(1, 116, 86, 174).drawRect(89, 116, 174, 174);
  g.drawString(left, 44, 146).drawString(right, 132, 146);
}
function ui(touch, back) {
  Bangle.setUI({ mode: "custom", touch: function(_, xy) {
    if (xy && xy.y >= 116) touch(xy.x < 88);
  }, btn: back, remove: stopTick });
}
function showTimer(title, minutes) {
  E.showMenu();
  var now = Date.now();
  deadline = now + minutes * 60000;
  warningAt = deadline - 60000;
  function cancel() { deadline = 0; showMenu(); }
  function draw() {
    var left = deadline - Date.now();
    if (left <= 0) {
      stopTick();
      deadline = 0;
      Bangle.buzz(300).then(function() { if (deadline === 0) return Bangle.buzz(300); });
      display(title, "0:00", "Done", "Done");
    } else {
      if (warningAt && Date.now() >= warningAt) { warningAt = 0; Bangle.buzz(180); }
      display(title, clock(Math.ceil(left / 1000) * 1000), "End", "End");
    }
  }
  ui(cancel, cancel);
  draw();
  tick = setInterval(draw, 500);
}
function stopwatch() {
  E.showMenu();
  function time() { return elapsed + (started === null ? 0 : Date.now() - started); }
  function draw() {
    display("Stopwatch", clock(time(), true), started === null ? "Start" : "Pause",
      started === null ? "Reset" : "Lap");
    if (laps.length) g.setFont("6x8").drawString("Lap " + laps.length + "  " + clock(laps[laps.length - 1], true), 88, 99);
  }
  ui(function(left) {
    if (left && started === null) started = Date.now();
    else if (left) { elapsed = time(); started = null; }
    else if (started === null) { elapsed = 0; laps = []; }
    else if (laps.length < 99) laps.push(time());
    draw();
  }, showMenu);
  draw();
  tick = setInterval(draw, 200);
}
function mark(label) {
  var entries = S.readJSON(markersFile, 1) || [];
  if (entries.length >= 100) return E.showAlert("Marker log is full.").then(showMarkers);
  entries.push({ at: Date.now(), label: label });
  try {
    if (S.writeJSON(markersFile, entries) === false) throw new Error("Storage full");
  } catch (e) {
    return E.showAlert("Marker could not be saved.").then(showMarkers);
  }
  Bangle.buzz(40);
  showMarkers();
}
function showMarkers() {
  var entries = S.readJSON(markersFile, 1) || [];
  E.showMenu({
    "": { title: "Mark a moment", back: backToApp },
    "Coffee": function() { mark("Coffee"); },
    "Headache": function() { mark("Headache"); },
    "Workout note": function() { mark("Workout note"); },
    "Idea": function() { mark("Idea"); },
    "Recent markers": function() {
      var m = { "": { title: "Recent markers", back: showMarkers } };
      entries.slice(-8).reverse().forEach(function(entry, i) {
        m[(entries.length - i) + ". " + entry.label] = function() {
          E.showAlert(new Date(entry.at).toString(), entry.label).then(showMarkers);
        };
      });
      if (!entries.length) m["No markers yet"] = showMarkers;
      E.showMenu(m);
    }
  });
}
function progress() {
  E.showMenu();
  function draw() {
    var now = new Date(), pending = L.pendCount();
    var steps = Bangle.getHealthStatus("day").steps;
    var time = ("0" + now.getHours()).substr(-2) + ":" + ("0" + now.getMinutes()).substr(-2);
    g.reset().setColor("#102").fillRect(0, 0, 175, 175);
    g.setColor("#ff8").setFont("Vector", 42).setFontAlign(0, 0).drawString(time, 88, 51);
    g.setColor("#0ff").setFont("6x15").drawString(steps + " STEPS", 88, 99);
    g.setColor("#faf").drawString(pending.sets + " SETS TO SYNC", 88, 126);
  }
  Bangle.setUI({ mode: "custom", btn: backToApp, remove: stopTick });
  draw();
  tick = setInterval(draw, 5000);
}
function showMenu() {
  stopTick();
  E.showMenu({
    "": { title: "Timers", back: backToApp },
    "Chalk talk (5m)": function() { showTimer("Chalk talk", 5); },
    "Presentation (10m)": function() { showTimer("Presentation", 10); },
    "Focus (25m)": function() { showTimer("Focus", 25); },
    "Stretch (2m)": function() { showTimer("Stretch", 2); },
    "Stopwatch": stopwatch
  });
}
exports.open = function(back) { backToApp = back; showMenu(); };
exports.markers = function(back) { backToApp = back; showMarkers(); };
exports.progress = function(back) { backToApp = back; progress(); };

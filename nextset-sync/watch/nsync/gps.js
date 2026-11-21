/* NextSet Sync Run / Walk engine (Storage module "nsync-gps").
 *
 * Pure functions on a plain state object, so the same code runs on the watch
 * and in the tests with synthetic tracks (protocol/fixtures/gps-tracks.json).
 * The screen and GPS power live in run.js.
 *
 * Distance: GPS fixes are averaged over the last 3 seconds, then distance is
 * added only once the averaged position has moved at least MIN_MOVE metres
 * from the last counted point, so standing still does not add distance.
 * Rejected: no fix; a stalled receiver repeating an old fix (its own time
 * does not advance); hdop above 6; a jump faster than 9 m/s plus 20 m. After
 * a gap the straight line from the last good point is counted (a little short
 * on a bend, never long).
 * Paused time and distance are not counted: the first fix after Resume
 * starts afresh from where you are.
 * Splits: distance only ever grows, so each mile (or km) boundary is crossed
 * exactly once, whatever the GPS does near it, and the split count is part of
 * the saved state, so a pause, an app restart or a reboot never repeats one.
 * Pace: between counted points over the last 30 s; null (shown blank) while
 * paused, searching, lost (no fresh fix for 10 s), stale (5 s), when nothing
 * was counted for 15 s (standing still) or slower than 0.4 m/s.
 */
var MILE = 1609.344, KM = 1000;
var C = { lostMs: 10000, staleMs: 5000, minMove: 10, maxSpeed: 9, jump: 20, smooth: 3, paceWin: 30000,
  ptMove: 15, ptMs: 30000, maxHdop: 6, minSpeed: 0.4, stopMs: 15000 };
exports.C = C;
exports.MILE = MILE;
function unitM(u) { return u == "km" ? KM : MILE; }
exports.unitM = unitM;

// Metres between two {lat, lon}; equirectangular, exact enough below a few km.
function dist(a, b) {
  var k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos((a.lat + b.lat) * k / 2), y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371008.8;
}
exports.dist = dist;

exports.create = function(mode, units, buzz, now) {
  return { v: 1, mode: mode, units: units == "km" ? "km" : "mi", buzz: !!buzz, start: now,
    dist: 0, mov: 0, seg: now, paused: false, fixAt: 0, gpsT: 0, last: null, sm: [], win: [],
    sp: 0, splitMov: 0, splits: [], wpt: null, n: 0 };
};
function moving(r, now) { return r.mov + (r.paused ? 0 : now - r.seg); }
exports.moving = moving;
exports.status = function(r, now) { // "search" | "ok" | "lost"
  if (!r.fixAt) return "search";
  return now - r.fixAt > C.lostMs ? "lost" : "ok";
};

// One GPS event. Returns { pt: [seconds since start, lat, lon] to append to the
// route, split: { n, s } when a mile/km was just completed } (either may be absent).
exports.onFix = function(r, f, now) {
  var out = {};
  if (!f || !f.fix || !isFinite(f.lat) || !isFinite(f.lon)) return out;
  var ft = f.time && f.time.getTime ? f.time.getTime() : 0;
  if (ft && r.gpsT && ft <= r.gpsT) return out; // stalled: the same fix again
  if (ft) r.gpsT = ft;
  if (f.hdop && f.hdop > C.maxHdop) return out;
  if (r.fixAt && now - r.fixAt > C.staleMs) r.sm = []; // don't average across a gap
  var raw = { lat: f.lat, lon: f.lon };
  if (r.last && dist(r.last, raw) > C.maxSpeed * Math.max(1, (now - r.last.t) / 1000) + C.jump) return out; // wild fix
  r.fixAt = now;
  r.sm.push(raw);
  if (r.sm.length > C.smooth) r.sm.shift();
  var lat = 0, lon = 0, i;
  for (i = 0; i < r.sm.length; i++) { lat += r.sm[i].lat; lon += r.sm[i].lon; }
  var p = { lat: lat / r.sm.length, lon: lon / r.sm.length, t: now };
  if (r.paused) return out;
  if (!r.last) { r.last = p; r.win = [[now, r.dist]]; out.pt = point(r, p, now); return out; }
  var d = dist(r.last, p);
  if (d < C.minMove) return out;
  r.dist += d;
  r.last = p;
  r.win.push([now, r.dist]);
  while (r.win.length > 2 && now - r.win[1][0] >= C.paceWin) r.win.shift();
  if (!r.wpt || dist(r.wpt, p) >= C.ptMove || now - r.wpt.t >= C.ptMs) out.pt = point(r, p, now);
  var u = unitM(r.units);
  while (r.dist >= (r.sp + 1) * u) {
    r.sp++;
    var mv = moving(r, now), s = Math.round((mv - r.splitMov) / 1000);
    r.splitMov = mv;
    r.splits.push(s);
    out.split = { n: r.sp, s: s };
  }
  return out;
};
function point(r, p, now) {
  r.wpt = p;
  r.n++;
  return [Math.round((now - r.start) / 1000), Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5];
}

// Seconds per mile (or km), or null when there is no reliable current pace.
exports.pace = function(r, now) {
  if (r.paused || !r.fixAt || now - r.fixAt > C.staleMs || r.win.length < 2) return null;
  var a = r.win[0], b = r.win[r.win.length - 1], dt = (b[0] - a[0]) / 1000;
  if (dt < 8 || now - b[0] > C.stopMs) return null; // too little yet, or stopped
  var sp = (b[1] - a[1]) / dt;
  return sp < C.minSpeed ? null : unitM(r.units) / sp;
};

exports.pause = function(r, now) {
  if (r.paused) return;
  r.mov += now - r.seg;
  r.paused = true;
  r.last = null; r.win = []; r.sm = []; r.wpt = null;
};
exports.resume = function(r, now) {
  if (!r.paused) return;
  r.seg = now;
  r.paused = false;
};

// The record that syncs to the iPhone (kind "act"); the route goes separately.
exports.summary = function(r, now) {
  var mv = moving(r, now);
  return { k: "act", mode: r.mode, units: r.units, at: r.start, end: now, dist: Math.round(r.dist),
    mov: Math.round(mv / 1000), el: Math.round((now - r.start) / 1000), splits: r.splits.slice(), n: r.n };
};

// "8:05" from seconds; "--:--" for null.
exports.clock = function(s) {
  if (s === null || s === undefined || !isFinite(s)) return "--:--";
  s = Math.round(s);
  var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = ("0" + s % 60).substr(-2);
  return h ? h + ":" + ("0" + m).substr(-2) + ":" + x : m + ":" + x;
};

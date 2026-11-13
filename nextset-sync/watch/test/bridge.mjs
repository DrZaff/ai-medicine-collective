#!/usr/bin/env node
// Runs the real watch code (boot.js + lib.js, with Sleep Log 0.26's lib and
// the shared fixture) inside the Espruino interpreter and exposes its BLE
// characteristics as lines on stdin/stdout, so the Swift sync engine can talk
// to it (Tests/NextSetSyncCoreTests/espruino-bridge-tests.swift).
//
// (Inside Espruino, commands arrive through a file the script polls, because
// the Linux build hands stdin to its REPL.)
//   stdin:  "W <hex>"  phone writes a chunk      stdout: "N <hex>"  notification
//           "D"        link drops                        "R"        ready
//           "L <reps>" person logs a set on the watch    "E <text>" watch-side error
//           "F"        person finishes the workout
import {readFileSync, mkdtempSync, writeFileSync, appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(here, p), 'utf8');
const expected = JSON.parse(read('../../protocol/fixtures/sleep-expected.json'));
const FILES = {
  lib: read('../nsync/lib.js'), boot: read('../nsync/boot.js'), sleeplog: read('vendor/sleeplog-0.26-lib.js'),
  log: read('../../protocol/fixtures/sleeplog-sample.log'),
  archive: read('../../protocol/fixtures/sleeplog-archive.json'), archiveName: expected.archiveFileName,
};
const body = `
var S = require("Storage");
S.eraseAll();
S.write("nsync", FILES.lib); S.write("sleeplog", FILES.sleeplog);
S.writeJSON("sleeplog.info", {id: "sleeplog", version: "0.26"});
S.write(FILES.archiveName, FILES.archive);
S.open("sleeplog.log", "w").write(FILES.log);
var SVC = "d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40", RXC = "d9a50002-3c1f-4b0e-9f5d-7a1e6c2b8f40";
function hex(s) { var o = ""; for (var i = 0; i < s.length; i++) o += (256 + s.charCodeAt(i)).toString(16).substr(1); return o; }
function unhex(h) { var o = ""; for (var i = 0; i < h.length; i += 2) o += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return o; }
global.NRF = { ev: {}, on: function(e, f) { (this.ev[e] = this.ev[e] || []).push(f); },
  updateServices: function(u) { print("N " + hex(u[SVC]["d9a50003-3c1f-4b0e-9f5d-7a1e6c2b8f40"].value)); },
  getSecurityStatus: function() { return {connected: true}; } };
global.bleServices = {}; global.bleServiceOptions = {uart: true};
global.NSYNC_PAIR = function(name, code, cb) { cb(true); };
eval(FILES.boot);
var L = require("nsync"), buf = "";
function logSet(reps) {
  var w = S.readJSON("nsync.wkt.json"), c = L.cfg(), now = Date.now();
  var ses = L.readSes() || {sid: c.wid + "-" + Math.floor(now / 1000).toString(36), n: 0, start: now};
  ses.n++;
  L.writeSes(ses);
  L.putRec({k: "set", id: ses.sid + ".0." + ses.n, rev: 1, sid: ses.sid, wid: w.id, wn: w.name, xi: 0, xid: w.ex[0].id,
    xn: w.ex[0].name, set: ses.n, load: w.ex[0].load || 0, units: w.units, reps: reps, rir: 2, at: now});
}
function finish() {
  var ses = L.readSes(), w = S.readJSON("nsync.wkt.json");
  L.putRec({k: "ses", id: ses.sid, rev: 1, sid: ses.sid, wid: w.id, wn: w.name, units: w.units, start: ses.start,
    end: Date.now(), n: ses.n, at: Date.now()});
  L.eraseSes();
}
var done = 0;
setInterval(function() {
  var c = require("fs").readFileSync("cmd.txt");
  if (!c || c.length <= done) return;
  buf += c.substr(done); done = c.length;
  var i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    var l = buf.substr(0, i); buf = buf.substr(i + 1);
    try {
      if (l[0] == "W") bleServices[SVC][RXC].onWrite({data: E.toArrayBuffer(unhex(l.substr(2)))});
      else if (l[0] == "D") (NRF.ev.disconnect || []).forEach(function(f) { f(); });
      else if (l[0] == "L") logSet(parseInt(l.substr(2), 10));
      else if (l[0] == "F") finish();
    } catch (e) { print("E " + e); }
  }
}, 10);
print("R");
`;
const dir = mkdtempSync(join(tmpdir(), 'nsync-bridge-'));
writeFileSync(join(dir, "bridge.js"), `var FILES=${JSON.stringify(FILES)};\n${body}`);
writeFileSync(join(dir, 'cmd.txt'), '');
const child = spawn(process.env.ESPRUINO || 'espruino', ['bridge.js'], {cwd: dir, stdio: ['pipe', 'pipe', 'ignore']});
let pending = '';
child.stdout.setEncoding('latin1');
child.stdout.on('data', d => {
  pending += d;
  const lines = pending.split('\n'); pending = lines.pop();
  for (const raw of lines) {
    if (process.env.BRIDGE_RAW) process.stderr.write(JSON.stringify(raw) + '\n');
    const l = raw.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/^[^NRE]*(?=[NRE]( |$))/, '');
    if (/^(N [0-9a-f]+|R|E .*)$/.test(l)) process.stdout.write(l + '\n');
  }
});
// stdin of the interpreter stays open and silent; our stdin feeds cmd.txt.
process.stdin.on('data', d => appendFileSync(join(dir, 'cmd.txt'), d));
process.stdin.on('end', () => child.kill());
child.on('exit', () => process.exit(0));

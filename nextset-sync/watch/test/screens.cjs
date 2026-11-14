#!/usr/bin/env node
/* Screenshots of every NextSet Sync watch screen from the official Bangle.js 2
 * emulator: the real firmware (2v29) compiled to WebAssembly, from the
 * EspruinoWebIDE repository. Lets anyone review the 176x176 layout without
 * the watch.
 *
 *   IDE=/path/to/EspruinoWebIDE node watch/test/screens.cjs <output dir>
 *
 * Writes one PNG per screen (176x176, plus a 3x copy for reading) and
 * contact-sheet.png. Exits non-zero if a screen is blank or an error is printed.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IDE = process.env.IDE;
const OUT = process.argv[2] || 'screens';
if (!IDE || !fs.existsSync(IDE + '/emu/emulator_banglejs2.js')) {
  console.error('Set IDE to an EspruinoWebIDE checkout (git clone https://github.com/espruino/EspruinoWebIDE)');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const HERE = __dirname, APP = path.join(HERE, '..', 'nsync');
const read = p => fs.readFileSync(p, 'utf8');

let consoleText = '';
const emu = (function() {
  /* eslint-disable no-eval */
  var jsRXCallback, jsUpdateGfx;
  const origLog = console.log;
  console.log = (...a) => { const s = a.join(' '); if (s.startsWith('EMSCRIPTEN:')) consoleText += s.slice(12) + '\n'; else origLog(...a); };
  eval(read(IDE + '/emu/emulator_banglejs2.js'));
  eval(read(IDE + '/emu/emu_banglejs2.js'));
  eval(read(IDE + '/emu/common.js'));
  jsRXCallback = () => {};
  jsUpdateGfx = () => {};
  return { init: () => { jsInit(); jsIdle(); }, tx: jsTransmitString, stop: jsStopIdle, gfx: jsGetGfxContents, W: GFX_WIDTH, H: GFX_HEIGHT };
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = js => emu.tx('\x10' + js.replace(/\n/g, ' ') + '\n');

function writeFile(name, content) {
  // Chunked Storage.write, the way the App Loader uploads.
  const size = Buffer.byteLength(content, 'latin1');
  for (let off = 0; off < content.length; off += 800) {
    const part = content.slice(off, off + 800);
    send(`require("Storage").write(${JSON.stringify(name)},${JSON.stringify(part)},${off},${size})`);
  }
}

function png(rgba, w, h, scale) {
  const W = w * scale, H = h * scale, rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x++) {
      const i = ((Math.floor(y / scale) * w) + Math.floor(x / scale)) * 4;
      row[1 + x * 3] = rgba[i]; row[2 + x * 3] = rgba[i + 1]; row[3 + x * 3] = rgba[i + 2];
    }
    rows.push(row);
  }
  const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const shots = [];
async function shoot(name) {
  await sleep(700);
  const rgba = new Uint8Array(emu.W * emu.H * 4);
  emu.gfx(rgba);
  const first = rgba.slice(0, 3).join();
  let blank = true;
  for (let i = 0; i < rgba.length; i += 4) if (rgba.slice(i, i + 3).join() !== first) { blank = false; break; }
  fs.writeFileSync(path.join(OUT, name + '.png'), png(rgba, emu.W, emu.H, 1));
  fs.writeFileSync(path.join(OUT, name + '@3x.png'), png(rgba, emu.W, emu.H, 3));
  shots.push({ name, rgba: Uint8Array.from(rgba), blank });
  console.log((blank ? 'BLANK ' : 'ok    ') + name);
}

(async () => {
  // The WebAssembly runtime finishes loading asynchronously.
  for (let tries = 0; ; tries++) {
    await sleep(250);
    try { emu.init(); break; } catch (e) { if (tries > 40) throw e; }
  }
  await sleep(1500);
  const now = Date.now();
  // App files exactly as installed, plus the Scheduler it depends on.
  writeFile('nsync', read(path.join(APP, 'lib.js')));
  writeFile('nsync.app.js', read(path.join(APP, 'app.js')));
  writeFile('nsync-tools', read(path.join(APP, 'tools.js')));
  writeFile('sched', read(path.join(HERE, 'vendor', 'sched-0.43-lib.js')));
  writeFile('sched.boot.js', read(path.join(HERE, 'vendor', 'sched-0.43-boot.js')));
  // A synthetic workout, a previous set for the Ghost, a paired phone, a marker.
  send(`require("Storage").writeJSON("nsync.wkt.json",${JSON.stringify({ id: 'sample-full-body-a', rev: 1, name: 'Full Body A', units: 'lb', ex: [
    { id: 'goblet', name: 'Goblet squat', sets: 3, reps: '8-12', rir: 1, rest: 120, load: 185, tempo: '2-1-2' },
    { id: 'press', name: 'Neutral-grip dumbbell press', sets: 3, reps: '8-12', rir: 2, rest: 120, load: 40 }] })})`);
  send(`require("Storage").writeJSON("nsync.last.json",{goblet:{load:45,reps:10,rir:2,units:"lb"}})`);
  send(`require("Storage").writeJSON("nsync.json",{wid:"7a3c91e0",phones:{P:{key:"0",name:"iPhone",at:${now}}},lastSync:${now - 3600e3}})`);
  // As on a real watch after install: the bootloader includes our service and boot code ran.
  // The firmware runs .boot0 on every load(), as the bootloader's does on a real watch.
  send(`require("Storage").write(".boot0","var bleServices={};bleServices['d9a50001-3c1f-4b0e-9f5d-7a1e6c2b8f40']={};global.NSYNC={};")`);
  send(`if(!global.NRF||!NRF.getSecurityStatus)global.NRF={getSecurityStatus:function(){return{connected:false}},on:function(){},updateServices:function(){}}`);
  await sleep(1500);
  send(`require("nsync").addMark("Coffee",${now - 5400e3});require("nsync").addMark("Idea",${now - 600e3})`);
  await sleep(500);

  send('load("nsync.app.js")'); await sleep(1500);
  await shoot('01-main-menu');
  send('startSession()'); await shoot('02-set-entry-ghost');
  send('showTempo()'); await shoot('16-tempo-metronome');
  send('showEntry();draft.load=185;showPlates()'); await shoot('17-plates-per-side');
  send('showWarmup()'); await shoot('18-warm-up-ramp');
  send('showEntry()');
  send('Bangle.emit("touch",1,{x:87,y:70,type:0})'); await shoot('03-reps-selected');
  send('Bangle.emit("touch",1,{x:150,y:140,type:0})'); await shoot('04-rest-timer');
  send('endRest(true)'); await sleep(300);
  send('showSessionMenu()'); await shoot('05-session-menu');
  send('showSetList()'); await shoot('06-logged-sets');
  send('showMain();require("nsync-tools").open(showMain)'); await shoot('07-timers-menu');
  send(`require("Storage").writeJSON("nsync.timer.json",{title:"Focus",end:${now + 754e3},alarms:true});showMain();require("nsync-tools").open(showMain)`);
  await shoot('08-focus-timer');
  send('require("nsync-tools").stopwatch(showMain)'); await shoot('19-stopwatch');
  send('require("nsync-tools").markers(showMain)'); await shoot('09-mark-a-moment');
  send('require("nsync-tools").progress(showMain)'); await shoot('10-retro-status');
  send('showSelfTest()'); await shoot('11-self-test');
  send('showCheckin()'); await shoot('15-check-in');
  send('showSyncInfo()'); await shoot('12-sync-info');
  send('showPair()'); await shoot('13-pair-phone');
  send('showEntry();showSessionMenu();showSetList();setActions(ses.recs[0])');
  await shoot('14-set-actions');
  send('editing=ses.recs[0];draft=null;showEntry()'); await shoot('20-edit-set');
  send('editing=null;draft=null;askFinish()'); await shoot('21-finish-confirmation');
  send('showPair();global.NSYNC_PAIR("Demo phone","1234",function(){})'); await shoot('22-pair-confirmation');

  // Contact sheet: 4 columns at 2x with a gap.
  const S = 2, G = 8, C = 4, R = Math.ceil(shots.length / C);
  const W = C * (emu.W * S + G) + G, H = R * (emu.H * S + G) + G;
  const sheet = new Uint8Array(W * H * 4).fill(60);
  shots.forEach((s, k) => {
    const ox = G + (k % C) * (emu.W * S + G), oy = G + Math.floor(k / C) * (emu.H * S + G);
    for (let y = 0; y < emu.H * S; y++) for (let x = 0; x < emu.W * S; x++) {
      const si = ((Math.floor(y / S) * emu.W) + Math.floor(x / S)) * 4, di = ((oy + y) * W + ox + x) * 4;
      sheet[di] = s.rgba[si]; sheet[di + 1] = s.rgba[si + 1]; sheet[di + 2] = s.rgba[si + 2];
    }
  });
  fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), png(sheet, W, H, 1));
  emu.stop();
  const errors = consoleText.split('\n').filter(l => /Uncaught|Error|ASSERT/.test(l));
  fs.writeFileSync(path.join(OUT, 'console.txt'), consoleText);
  if (errors.length) console.log('Watch console errors:\n' + errors.join('\n'));
  const blank = shots.filter(s => s.blank).map(s => s.name);
  if (blank.length) console.log('Blank screens: ' + blank.join(', '));
  process.exit(errors.length || blank.length ? 1 : 0);
})();

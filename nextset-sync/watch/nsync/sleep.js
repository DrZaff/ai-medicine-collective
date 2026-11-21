/* NextSet Sync Sleep face (Storage module "nsync-sleep"), loaded only when opened.
 *
 * The approved square-bezel reptile eye (design/sleep-face/), converted by
 * scripts/make-sleep-face.py. The open frame is drawn whole; each blink frame is
 * the rectangle that differs from it, drawn at EYE_X, EYE_Y, so the bezel never
 * changes.
 *
 * Blink: open -> closing 50 ms -> nearly 40 -> closed 70 -> nearly 50 -> closing 60 -> open.
 * Once on entry, then every 30-90 s, only while the LCD is already on. This
 * screen never turns the LCD or backlight on and never changes brightness.
 * LCD off: every pending frame and blink timer is cancelled. LCD on: the open
 * frame is redrawn and the next blink is scheduled. No clock, no widgets.
 * Sleep Log keeps recording on its own (it runs from its boot code); this
 * screen does not touch it.
 * The button (not the press that only woke the screen) goes back.
 */
var S = require("Storage");
var FRAMES = ["nsync.eye0.img", "nsync.eye1.img", "nsync.eye2.img", "nsync.eye3.img"]; // open, closing, nearly, closed
var EYE_X = 13, EYE_Y = 13;
var SEQ = [[1, 50], [2, 40], [3, 70], [2, 50], [1, 60]]; // [frame, ms shown]; then open
var cfg = { min: 30000, max: 90000 };                  // pause between blinks
var st = null; // {back, frameT, blinkT, onLCD, onLock, lastUnlock, frames, blinks}

function lcdOn() { return !Bangle.isLCDOn || Bangle.isLCDOn(); }
function draw(i) {
  var im = S.read(FRAMES[i]); // memory-mapped: no RAM copy
  if (!im) { g.reset().clear().setFontAlign(0, 0).setFont("6x15").drawString("Sleep face missing:\nreinstall NextSet Sync", 88, 88); return; }
  g.reset().drawImage(im, i ? EYE_X : 0, i ? EYE_Y : 0);
  if (g.flip) g.flip();
  st.frames.push(i); // the last few frames, for the tests
  if (st.frames.length > 12) st.frames.shift();
}
function cancel() {
  if (st.frameT) clearTimeout(st.frameT);
  if (st.blinkT) clearTimeout(st.blinkT);
  st.frameT = st.blinkT = undefined;
}
function blink() {
  st.blinkT = undefined;
  if (!lcdOn()) return; // never wake the screen for this
  st.blinks++;
  var k = 0;
  function nextFrame() {
    st.frameT = undefined;
    if (!lcdOn()) return;
    if (k >= SEQ.length) { draw(0); schedule(); return; }
    var f = SEQ[k++];
    draw(f[0]);
    st.frameT = setTimeout(nextFrame, f[1]);
  }
  nextFrame();
}
function schedule() {
  if (st.blinkT) clearTimeout(st.blinkT);
  st.blinkT = setTimeout(blink, cfg.min + Math.random() * (cfg.max - cfg.min));
}
function onLCD(on) {
  if (!st) return;
  cancel();
  if (on) { draw(0); schedule(); }
}
function onLock(locked) { if (st && !locked) st.lastUnlock = Date.now(); }
function close() {
  if (!st) return;
  cancel();
  Bangle.removeListener("lcdPower", st.onLCD);
  Bangle.removeListener("lock", st.onLock);
  st = null;
}
function open(back) {
  close();
  st = { back: back, lastUnlock: 0, frames: [], blinks: 0, onLCD: onLCD, onLock: onLock };
  Bangle.on("lcdPower", onLCD);
  Bangle.on("lock", onLock);
  Bangle.setUI({ mode: "custom", remove: close, btn: function() {
    if (Date.now() - st.lastUnlock < 400) return; // that press only woke the screen
    var b = st.back;
    Bangle.setUI(); // runs close()
    b();
  } });
  draw(0);
  if (lcdOn()) blink(); // otherwise the first blink waits for the LCD to come on
}
exports.open = open;
exports.cfg = cfg;   // tests shorten the pause
exports.state = function() { return st; };
exports.SEQ = SEQ;

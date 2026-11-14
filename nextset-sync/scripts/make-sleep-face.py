#!/usr/bin/env python3
"""Convert the approved Sleep face artwork (design/sleep-face/*.png, 176x176,
full colour) into Bangle.js 2 images for watch/nsync/.

The Bangle.js 2 LCD shows 8 colours (3 bits). Each frame is Floyd-Steinberg
dithered to the four the artwork uses (black, green, yellow, white) and stored
as a 2-bit image with a palette (Espruino image format: width, height,
bpp | 64, then 4 x RGB565 little-endian, then pixels packed MSB first).

* eye-open: the full 176x176 open frame, drawn once.
* eye-closing / eye-nearly / eye-closed: only the rectangle that differs from
  the open frame (the same rectangle for all three, at BLINK_AT), drawn over it. Pixels whose source colour equals the open
  frame's copy the open frame's dithered pixel, so the bezel and everything
  outside the eyelid never shimmer between frames: the bezel stays fixed.
  Eyelid pixels get a little sharpening and contrast first, because plain
  dithering turns the lid's scale texture to noise.

Run from nextset-sync/:  python3 scripts/make-sleep-face.py
Writes watch/nsync/eye-*.js (each evaluates to the image string on upload) and
design/sleep-face/watch-preview.png (what the watch will show, 3x).
Needs Pillow.
"""
import base64
import os
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "design", "sleep-face")
OUT = os.path.join(ROOT, "watch", "nsync")
FRAMES = [("open", "01-open.png"), ("closing", "02-closing.png"),
          ("nearly", "03-nearly-closed.png"), ("closed", "04-closed.png")]
PALETTE = [(0, 0, 0), (0, 255, 0), (255, 255, 0), (255, 255, 255)]
SAME = 24      # max channel difference that still counts as "same as open"
BLINK_AT = (13, 13)  # top-left of the blink frames; sleep.js draws them there
LID = (1.4, 0.75, 150)  # contrast, brightness, unsharp percent for eyelid pixels


def palette_image():
    p = Image.new("P", (1, 1))
    flat = [c for rgb in PALETTE for c in rgb]
    p.putpalette(flat + [0] * (768 - len(flat)))
    return p


def dither(im):
    return im.quantize(palette=palette_image(), dither=Image.Dither.FLOYDSTEINBERG)


def rgb565(c):
    r, g, b = c
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def encode(indexed, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    px = indexed.load()
    out = bytearray([w, h, 2 | 64])
    for c in PALETTE:
        v = rgb565(c)
        out += bytes([v & 255, v >> 8])
    acc = bits = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            acc = (acc << 2) | px[x, y]
            bits += 2
            if bits == 8:
                out.append(acc)
                acc = bits = 0
    if bits:
        out.append(acc << (8 - bits))
    return bytes(out)


def main():
    src = [Image.open(os.path.join(SRC, f)).convert("RGB") for _, f in FRAMES]
    assert all(s.size == (176, 176) for s in src), "frames must be 176x176"
    open_d = dither(src[0])
    shown = [open_d]
    files = {"open": open_d}
    for (name, _), im in list(zip(FRAMES, src))[1:]:
        c, b, u = LID
        lid = im.filter(ImageFilter.UnsharpMask(2, u, 2))
        lid = ImageEnhance.Brightness(ImageEnhance.Contrast(lid).enhance(c)).enhance(b)
        d = dither(lid)
        changed = ImageChops.difference(src[0], im).convert("L").point(lambda v: 255 if v > SAME else 0)
        frame = Image.composite(d, open_d, changed)  # mode P, same palette
        frame.putpalette(open_d.getpalette())
        files[name] = frame
        shown.append(frame)
    # One rectangle for every blink frame, so the watch draws each at the same place.
    boxes = [ImageChops.difference(files[n].convert("RGB"), open_d.convert("RGB")).getbbox() for n in files if n != "open"]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    assert box[:2] == BLINK_AT, "blink frames now start at %s: update BLINK_AT here and EYE_X/EYE_Y in sleep.js" % (box[:2],)
    for n in list(files):
        files[n] = (files[n], box)
    files["open"] = (open_d, (0, 0, 176, 176))
    for name, (img, box) in files.items():
        data = encode(img, box)
        path = os.path.join(OUT, "eye-%s.js" % name)
        with open(path, "w") as f:
            f.write('atob("%s")\n' % base64.b64encode(data).decode())
        print("%-8s box=%s %5d bytes -> %s" % (name, box, len(data), os.path.relpath(path, ROOT)))
    sheet = Image.new("RGB", (176 * 4 + 24, 176), (60, 60, 60))
    for k, im in enumerate(shown):
        sheet.paste(im.convert("RGB"), (k * 184, 0))
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(os.path.join(SRC, "watch-preview.png"))


if __name__ == "__main__":
    main()

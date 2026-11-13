#!/usr/bin/env python3
"""16-bit style app icon: pixel map (icon.txt) + palette (palette.json) -> PNGs.

  python3 render.py            # draw the default design into icon.txt, then render
  python3 render.py --render   # only render icon.txt as edited by hand

icon.txt is 64 lines of 64 characters; each character is a palette key.
Edit pixels or colours there, re-run with --render. Output is opaque (App
Store icons may not be transparent) and scaled with no smoothing.
"""
import json, struct, sys, zlib
from pathlib import Path

HERE = Path(__file__).parent
N = 64
PALETTE = {
    "k": "#0B0614",  # outline black (slightly purple)
    "1": "#1A0B3B",  # sky: midnight purple
    "2": "#3B1680",  # sky: grape
    "3": "#6A1FA8",  # sky: ultraviolet
    "4": "#0E7C8C",  # horizon teal
    "y": "#FFD23F",  # gold
    "Y": "#FFF38A",  # gold highlight
    "o": "#FF8A1F",  # gold shade (orange)
    "p": "#FF3EA5",  # hot pink
    "P": "#FF9AD5",  # pink highlight
    "m": "#A0127A",  # magenta shadow
    "c": "#23E5DB",  # cyan
    "C": "#B8FFF8",  # cyan highlight
    "t": "#0A8F9A",  # teal shade
    "s": "#C9C9D6",  # steel
    "S": "#FFFFFF",  # white
}

FONT = {  # 5x7 glyphs
    "N": ["X...X", "XX..X", "XX..X", "X.X.X", "X..XX", "X..XX", "X...X"],
    "E": ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
    "X": ["X...X", "X...X", ".X.X.", "..X..", ".X.X.", "X...X", "X...X"],
    "T": ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "..X.."],
    "S": [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
}

def design():
    g = [[" "] * N for _ in range(N)]
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    bands = ["1", "2", "3", "4"]
    for y in range(N):  # dithered sky: midnight -> grape -> ultraviolet -> teal
        f = y / (N - 1) * (len(bands) - 1)
        i = min(int(f), len(bands) - 2)
        g[y] = [bands[i + 1] if (f - i) * 16 > bayer[y % 4][x % 4] else bands[i] for x in range(N)]
    for x, y in [(4, 4), (13, 7), (26, 3), (40, 6), (7, 22), (58, 20), (3, 38), (60, 36)]:
        g[y][x] = "S"
    for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:  # sparkle
        g[9 + dy][33 + dx] = "Y" if (dx or dy) else "S"
    # crescent moon, opening to the upper right, black outline
    cx, cy, r = 52, 6, 5
    moon = {(x, y) for y in range(N) for x in range(N)
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1 and (x - cx - 2) ** 2 + (y - cy + 2) ** 2 > (r - 1) ** 2}
    for x, y in moon:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if (x + dx, y + dy) not in moon and 0 <= y + dy < N:
                    g[y + dy][x + dx] = "k"
    for x, y in moon:
        g[y][x] = "P" if (x - cx) + (y - cy) < -3 else "p"

    def text(word, top, scale=2, gap=2):
        width = len(word) * 5 * scale + (len(word) - 1) * gap
        left = (N - width) // 2
        cells = set()
        for i, ch in enumerate(word):
            for gy, row in enumerate(FONT[ch]):
                for gx, v in enumerate(row):
                    if v == "X":
                        for sy in range(scale):
                            for sx in range(scale):
                                cells.add((left + i * (5 * scale + gap) + gx * scale + sx, top + gy * scale + sy))
        h = 7 * scale
        for x, y in cells:  # magenta drop shadow, 2 px down-right
            for d in (1, 2):
                if (x + d, y + d) not in cells:
                    g[y + d][x + d] = "m"
        for x, y in cells:  # black outline
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (x + dx, y + dy) not in cells:
                        g[y + dy][x + dx] = "k"
        for x, y in cells:  # gold with a highlight band and an orange base
            row = y - top
            g[y][x] = "Y" if row < h * 0.3 else ("y" if row < h * 0.75 else "o")

    text("NEXT", 13)
    text("SET", 31)
    # dumbbell
    def box(x0, y0, x1, y1, fill, hi, lo):
        for y in range(y0 - 1, y1 + 2):
            for x in range(x0 - 1, x1 + 2):
                g[y][x] = "k"
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                g[y][x] = hi if y == y0 or x == x0 else (lo if y == y1 or x == x1 else fill)
    box(17, 53, 46, 54, "s", "S", "s")                  # bar
    for x0, h in ((9, 3), (13, 6), (47, 6), (51, 3)):  # plates (outer smaller)
        box(x0, 53 - h, x0 + 2, 54 + h, "c", "C", "t")
    return ["".join(r) for r in g]

def render(lines, scale, path):
    rgb = {k: bytes(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in PALETTE.items()}
    rows = []
    for line in lines:
        row = b"".join(rgb[c] * scale for c in line)
        rows += [b"\x00" + row] * scale
    raw = b"".join(rows)
    size = N * scale
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

if __name__ == "__main__":
    if "--render" in sys.argv:
        lines = (HERE / "icon.txt").read_text().splitlines()
    else:
        lines = design()
        (HERE / "icon.txt").write_text("\n".join(lines) + "\n")
        (HERE / "palette.json").write_text(json.dumps(PALETTE, indent=1) + "\n")
    assert len(lines) == N and all(len(l) == N for l in lines), "icon.txt must be 64x64"
    assert all(c in PALETTE for l in lines for c in l), "unknown palette key in icon.txt"
    render(lines, 16, HERE / "icon-1024.png")   # App Store size
    render(lines, 3, HERE / "preview-192.png")  # roughly home-screen size
    render(lines, 1, HERE / "preview-64.png")
    print("rendered", HERE / "icon-1024.png")

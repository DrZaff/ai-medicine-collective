"""Instagram carousel for a blog post: the slides and the caption.

Reads blog/posts/YYYY-MM-DD.json and writes social/YYYY-MM-DD/:
    01.jpg ... NN.jpg   1080 x 1350 slides: a cover, one per review, a closing slide
    caption.txt         the text that goes under the post

No AI call: it only lays out text that is already in the post, so what is
reviewed in the blog draft is exactly what the slides say. The blog draft job
runs this, so the slides arrive in the same pull request as the post. The
"Instagram publish" job posts them after the pull request is merged.

Usage:
    python scripts/blog_agent/instagram.py --date YYYY-MM-DD
    python scripts/blog_agent/instagram.py --post path/to/post.json --out some/folder
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
POSTS_DIR = ROOT / "blog" / "posts"
SOCIAL_DIR = ROOT / "social"
FONTS = Path(__file__).resolve().parent / "fonts"
SITE = "aimedicinecollective.com"
HANDLE = "@aimedicinecollective"

W, H = 1080, 1350          # 4:5, the tallest shape Instagram shows in the feed
PAD = 84                   # side margin
MAX_ITEM_SLIDES = 6        # a carousel holds 10; cover + closing + at most this many

# The site's light look
NIGHT, NIGHT_2 = (5, 38, 31), (6, 50, 58)
PAPER, CARD = (245, 247, 250), (255, 255, 255)
INK, BODY, MUTED, LINE = (15, 23, 42), (51, 65, 85), (100, 116, 139), (226, 232, 240)
BRAND, SPARK, MINT, SOFT = (11, 107, 79), (16, 185, 129), (110, 231, 183), (232, 244, 239)
SKY, SKY_INK, AMBER, AMBER_INK = (224, 242, 254), (7, 89, 133), (254, 243, 199), (146, 64, 14)

SECTION_LABELS = {"med_ed": "MED-ED REVIEW", "ai_vs_human": "AI VS HUMAN"}
VERDICT_LABELS = {"ai_ahead": "AI AHEAD", "humans_ahead": "HUMANS AHEAD",
                  "comparable": "COMPARABLE", "mixed": "MIXED RESULTS"}


# ---------------------------------------------------------------- type

def serif(size: int, weight: int = 500, italic: bool = False) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONTS / ("Fraunces-Italic.ttf" if italic else "Fraunces.ttf")), size)
    font.set_variation_by_axes([min(144, max(9, size)), weight, 0, 0])   # optical size, weight, softness, wonky
    return font


def sans(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONTS / "Inter.ttf"), size)
    font.set_variation_by_axes([min(32, max(14, size)), weight])         # optical size, weight
    return font


def wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    lines, line = [], ""
    for word in " ".join(str(text).split()).split(" "):
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + ([line] if line else [])


def fit(draw, text: str, make_font, sizes: range, width: int, max_lines: int):
    """The largest size at which the text fits in max_lines; at the smallest
    size the text is cut with an ellipsis rather than overflowing."""
    for size in sizes:
        font = make_font(size)
        lines = wrap(draw, text, font, width)
        if len(lines) <= max_lines:
            return font, lines
    lines = lines[:max_lines]
    while lines[-1] and draw.textlength(lines[-1] + "…", font=font) > width:
        lines[-1] = lines[-1].rsplit(" ", 1)[0] if " " in lines[-1] else lines[-1][:-1]
    lines[-1] += "…"
    return font, lines


def paragraph(draw, xy, lines, font, fill, leading: float = 1.3) -> int:
    """Draw lines of text; returns the y just below them."""
    x, y = xy
    step = round(font.size * leading)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += step
    return y


def tracked(draw, xy, text: str, font, fill, spacing: float) -> int:
    """Letter-spaced capitals (Pillow has no letter-spacing); returns the end x."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + spacing
    return round(x - spacing)


def tracked_width(draw, text: str, font, spacing: float) -> int:
    return round(sum(draw.textlength(ch, font=font) + spacing for ch in text) - spacing)


def pill(draw, xy, text: str, background, color) -> int:
    """A rounded label; returns the x just after it."""
    font = sans(24, 700)
    x, y = xy
    width = tracked_width(draw, text, font, 2.2) + 44
    draw.rounded_rectangle((x, y, x + width, y + 50), radius=25, fill=background)
    tracked(draw, (x + 22, y + 11), text, font, color, 2.2)
    return x + width


# ---------------------------------------------------------------- shared pieces

def logo(size: int) -> Image.Image:
    """The [+] mark, drawn large and scaled down so its edges are smooth."""
    k = 4
    n = 512 * k
    tile = Image.new("RGB", (256, 256))
    px = tile.load()
    a, b = (10, 74, 58), (3, 29, 23)
    for y in range(256):
        for x in range(256):
            t = (x + y) / 510
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    im = tile.resize((n, n), Image.BILINEAR)
    d = ImageDraw.Draw(im)

    def line(points, color, width):
        pts = [(x * k, y * k) for x, y in points]
        w = width * k
        d.line(pts, fill=color, width=w, joint="curve")
        for x, y in pts:
            d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)

    line([(196, 128), (134, 128), (134, 384), (196, 384)], MINT, 36)
    line([(316, 128), (378, 128), (378, 384), (316, 384)], MINT, 36)
    line([(256, 192), (256, 320)], (255, 255, 255), 44)
    line([(192, 256), (320, 256)], (255, 255, 255), 44)
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, n, n), radius=112 * k, fill=255)
    im.putalpha(mask)
    return im.resize((size, size), Image.LANCZOS)


def night_canvas() -> Image.Image:
    """The dark-green stage, with one soft light at the top like the site's hero."""
    small = Image.new("RGB", (108, 135))
    px = small.load()
    for y in range(135):
        for x in range(108):
            t = min(1.0, (x * 0.35 + y) / 150)
            base = [NIGHT[i] + (NIGHT_2[i] - NIGHT[i]) * t for i in range(3)]
            glow = max(0.0, 1 - (((x - 54) / 62) ** 2 + ((y + 8) / 46) ** 2)) ** 1.6
            px[x, y] = tuple(round(base[i] + (SPARK[i] - base[i]) * glow * 0.42) for i in range(3))
    return small.resize((W, H), Image.BICUBIC)


def masthead(im: Image.Image, draw, dark: bool) -> None:
    mark = logo(64)
    im.paste(mark, (PAD, 76), mark)
    tracked(draw, (PAD + 84, 95), "AI MEDICINE COLLECTIVE", sans(25, 700), (255, 255, 255) if dark else INK, 2.4)


def footer(draw, index: int, total: int, dark: bool) -> None:
    color = MINT if dark else MUTED
    draw.text((PAD, H - 108), SITE, font=sans(27, 600), fill=color)
    # a row of dots, the current slide filled
    gap, r = 26, 7
    x = W - PAD - (total - 1) * gap
    for i in range(total):
        on = i == index
        fill = ((255, 255, 255) if dark else BRAND) if on else ((70, 110, 100) if dark else LINE)
        draw.ellipse((x - r, H - 92 - r, x + r, H - 92 + r), fill=fill)
        x += gap


def long_date(iso: str) -> str:
    day = dt.date.fromisoformat(iso)
    return f"{day.strftime('%B')} {day.day}, {day.year}"


# ---------------------------------------------------------------- slides

def cover(post: dict, total: int) -> Image.Image:
    im = night_canvas()
    draw = ImageDraw.Draw(im)
    masthead(im, draw, dark=True)

    label = f"BRIEFING  ·  {long_date(post['date']).upper()}"
    font = sans(24, 700)
    width = tracked_width(draw, label, font, 2.6) + 52
    draw.rounded_rectangle((PAD, 300, PAD + width, 356), radius=28, fill=(18, 62, 54), outline=(44, 96, 86))
    tracked(draw, (PAD + 26, 314), label, font, MINT, 2.6)

    font, lines = fit(draw, post["headline"], lambda s: serif(s, 500), range(104, 59, -4), W - 2 * PAD, 7)
    y = paragraph(draw, (PAD, 410), lines, font, (255, 255, 255), 1.08)

    count = len(post["items"])
    kinds = " + ".join(SECTION_LABELS.get(i.get("section"), "REVIEW").title().replace("Ai Vs", "AI vs").replace("Med-Ed", "Med-ed")
                       for i in post["items"][:2]) if count <= 2 else f"{count} reviews"
    draw.text((PAD, min(y + 36, H - 250)), kinds, font=serif(40, 400, italic=True), fill=MINT)

    draw.text((PAD, H - 108), "Swipe for the takeaways  →", font=sans(29, 600), fill=MINT)
    footer_dots_only(draw, 0, total, dark=True)
    return im


def footer_dots_only(draw, index: int, total: int, dark: bool) -> None:
    gap, r = 26, 7
    x = W - PAD - (total - 1) * gap
    for i in range(total):
        on = i == index
        fill = ((255, 255, 255) if dark else BRAND) if on else ((70, 110, 100) if dark else LINE)
        draw.ellipse((x - r, H - 92 - r, x + r, H - 92 + r), fill=fill)
        x += gap


def item_slide(item: dict, index: int, total: int) -> Image.Image:
    im = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 12), fill=SPARK)
    masthead(im, draw, dark=False)

    versus = item.get("section") == "ai_vs_human"
    x = pill(draw, (PAD, 210), SECTION_LABELS.get(item.get("section"), str(item.get("category", "REVIEW")).upper()),
             SKY if versus else SOFT, SKY_INK if versus else BRAND)
    if VERDICT_LABELS.get(item.get("verdict")):
        pill(draw, (x + 14, 210), VERDICT_LABELS[item["verdict"]], AMBER, AMBER_INK)

    font, lines = fit(draw, item["title"], lambda s: serif(s, 500), range(66, 43, -2), W - 2 * PAD, 5)
    y = paragraph(draw, (PAD, 300), lines, font, INK, 1.14)
    draw.text((PAD, y + 14), str(item.get("source", "")), font=serif(31, 400, italic=True), fill=MUTED)
    y += 96

    # "Why it matters" on a white card that takes the rest of the slide
    top, bottom = y, H - 170
    draw.rounded_rectangle((PAD - 24, top, W - PAD + 24, bottom), radius=30, fill=CARD, outline=LINE, width=2)
    draw.rounded_rectangle((PAD - 24, top + 34, PAD - 14, bottom - 34), radius=5, fill=SPARK)
    tracked(draw, (PAD + 22, top + 42), "WHY IT MATTERS", sans(24, 700), BRAND, 2.6)
    room = bottom - (top + 104) - 34
    for size in range(44, 27, -2):
        font = sans(size, 400)
        lines = wrap(draw, item.get("why_it_matters", ""), font, W - 2 * PAD - 44)
        if len(lines) * round(size * 1.42) <= room:
            break
    else:
        keep = max(1, room // round(size * 1.42))
        lines = lines[:keep]
        lines[-1] = lines[-1].rstrip(".,; ") + "…"
    paragraph(draw, (PAD + 22, top + 104), lines, font, BODY, 1.42)

    footer(draw, index, total, dark=False)
    return im


def closing(post: dict, total: int) -> Image.Image:
    im = night_canvas()
    draw = ImageDraw.Draw(im)
    masthead(im, draw, dark=True)

    y = paragraph(draw, (PAD, 330), ["Read the full", "briefing."], serif(108, 500), (255, 255, 255), 1.06)
    y = paragraph(draw, (PAD, y + 26), ["Sources, summaries", "and the fine print."], serif(54, 400, italic=True), MINT, 1.2)

    draw.rounded_rectangle((PAD, y + 60, W - PAD, y + 190), radius=65, fill=MINT)
    address = f"{SITE}/blog"
    font = sans(42, 700)
    draw.text(((W - draw.textlength(address, font=font)) / 2, y + 98), address, font=font, fill=NIGHT)

    small = sans(27, 400)
    note = ("Three briefings a week on AI in medicine. Summaries are AI-drafted and "
            "reviewed by clinicians before publishing. Always check the original source. "
            "Not medical advice.")
    paragraph(draw, (PAD, H - 330), wrap(draw, note, small, W - 2 * PAD), small, (190, 220, 210), 1.45)
    footer_dots_only(draw, total - 1, total, dark=True)
    draw.text((PAD, H - 108), f"Follow {HANDLE}", font=sans(29, 600), fill=MINT)
    return im


# ---------------------------------------------------------------- caption

def hashtag(tag: str) -> str:
    words = "".join(ch if ch.isalnum() else " " for ch in tag).split()
    return "#" + "".join(w if w.isupper() else w.capitalize() for w in words) if words else ""


def caption(post: dict) -> str:
    lines = [post["headline"], "", post.get("intro", ""), ""]
    for item in post["items"]:
        label = {"med_ed": "Med-ed", "ai_vs_human": "AI vs human"}.get(item.get("section"), "Review")
        lines.append(f"{label}: {item['title']} ({item['source']})")
    tags = ["#AIinMedicine", "#MedEd", "#MedicalEducation", "#DigitalHealth"]
    for tag in post.get("tags", []):
        made = hashtag(tag)
        if made and made.lower() not in {t.lower() for t in tags} and len(tags) < 10:
            tags.append(made)
    lines += [
        "",
        f"Full summaries and links to every source: {SITE}/blog?date={post['date']} (link in bio).",
        "",
        f"Follow {HANDLE} for three briefings a week on AI in medicine.",
        "",
        "AI-drafted and reviewed by clinicians before publishing. Always check the original source. Not medical advice.",
        "",
        " ".join(tags),
    ]
    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------- main

def build(post: dict, out: Path) -> list[Path]:
    items = post["items"][:MAX_ITEM_SLIDES]
    total = len(items) + 2
    slides = [cover(post, total), *(item_slide(item, i + 1, total) for i, item in enumerate(items)), closing(post, total)]
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.jpg"):
        old.unlink()
    paths = []
    for n, slide in enumerate(slides, 1):
        path = out / f"{n:02d}.jpg"
        slide.convert("RGB").save(path, "JPEG", quality=90, optimize=True)
        paths.append(path)
    (out / "caption.txt").write_text(caption(post), encoding="utf-8")
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", help="The post's date (YYYY-MM-DD)")
    parser.add_argument("--post", type=Path, help="A post file, instead of --date")
    parser.add_argument("--out", type=Path, help="Where to write (default: social/<date>/)")
    args = parser.parse_args()

    path = args.post or (POSTS_DIR / f"{args.date}.json" if args.date else None)
    if path is None or not path.exists():
        print(f"No post found ({path}); nothing to do.")
        return 0
    post = json.loads(path.read_text(encoding="utf-8"))
    if not post.get("items"):
        print("The post has no items; nothing to do.")
        return 0
    out = args.out or SOCIAL_DIR / post["date"]
    paths = build(post, out)
    print(f"Wrote {len(paths)} slides and caption.txt to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Instagram carousels: the slides and the caption.

Three kinds, each written to its own folder under social/:
    social/YYYY-MM-DD/          a blog post (build)
    social/digest-YYYY-MM-DD/   the weekly digest (build_digest; called by newsletter.py)
    social/review-YYYY-MM-DD/   an AI vs Human edition (build_review; called by living_review.py)

Each folder holds:
    01.jpg ... NN.jpg   1080 x 1350 slides: a cover, the content, a closing slide
    caption.txt         the text that goes under the post
    marker.txt          a phrase that is in the caption and in no other post's,
                        which is how the publisher knows a post is already up

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

def footer_dots_only(draw, index: int, total: int, dark: bool) -> None:
    gap, r = 26, 7
    x = W - PAD - (total - 1) * gap
    for i in range(total):
        on = i == index
        fill = ((255, 255, 255) if dark else BRAND) if on else ((70, 110, 100) if dark else LINE)
        draw.ellipse((x - r, H - 92 - r, x + r, H - 92 + r), fill=fill)
        x += gap


def card_slide(index: int, total: int, labels: list, title: str, source: str,
               box_label: str, box_text: str) -> Image.Image:
    """A light slide: small labels, a serif title, a source line, and a white
    card of reading text that takes the rest of the slide.
    labels: [(text, background, text colour), ...]"""
    im = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 12), fill=SPARK)
    masthead(im, draw, dark=False)

    x = PAD
    for text, background, color in labels:
        x = pill(draw, (x, 210), text, background, color) + 14

    font, lines = fit(draw, title, lambda s: serif(s, 500), range(66, 43, -2), W - 2 * PAD, 5)
    y = paragraph(draw, (PAD, 300), lines, font, INK, 1.14)
    if source:
        draw.text((PAD, y + 14), source, font=serif(31, 400, italic=True), fill=MUTED)
        y += 96
    else:
        y += 40

    top, bottom = y, H - 170
    draw.rounded_rectangle((PAD - 24, top, W - PAD + 24, bottom), radius=30, fill=CARD, outline=LINE, width=2)
    draw.rounded_rectangle((PAD - 24, top + 34, PAD - 14, bottom - 34), radius=5, fill=SPARK)
    tracked(draw, (PAD + 22, top + 42), box_label, sans(24, 700), BRAND, 2.6)
    room = bottom - (top + 104) - 34
    for size in range(44, 27, -2):
        font = sans(size, 400)
        lines = wrap(draw, box_text, font, W - 2 * PAD - 44)
        if len(lines) * round(size * 1.42) <= room:
            break
    else:
        keep = max(1, room // round(size * 1.42))
        lines = lines[:keep]
        lines[-1] = lines[-1].rstrip(".,; ") + "…"
    paragraph(draw, (PAD + 22, top + 104), lines, font, BODY, 1.42)

    footer(draw, index, total, dark=False)
    return im


def item_labels(item: dict) -> list:
    versus = item.get("section") == "ai_vs_human"
    labels = [(SECTION_LABELS.get(item.get("section"), str(item.get("category", "REVIEW")).upper()),
               SKY if versus else SOFT, SKY_INK if versus else BRAND)]
    if VERDICT_LABELS.get(item.get("verdict")):
        labels.append((VERDICT_LABELS[item["verdict"]], AMBER, AMBER_INK))
    return labels


def item_slide(item: dict, index: int, total: int) -> Image.Image:
    return card_slide(index, total, item_labels(item), item["title"], str(item.get("source", "")),
                      "WHY IT MATTERS", item.get("why_it_matters", ""))


def list_slide(index: int, total: int, label: str, heading: str, rows: list) -> Image.Image:
    """A light slide with a heading and up to five two-line rows: [(title, small print), ...]"""
    im = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 12), fill=SPARK)
    masthead(im, draw, dark=False)
    pill(draw, (PAD, 210), label, SOFT, BRAND)
    y = paragraph(draw, (PAD, 300), [heading], serif(66, 500), INK, 1.14) + 30
    rows = rows[:5]
    space = (H - 190 - y) // max(1, len(rows))
    for title, small in rows:
        draw.rounded_rectangle((PAD, y + 6, PAD + 8, y + space - 26), radius=4, fill=SPARK)
        font, lines = fit(draw, title, lambda s: serif(s, 500), range(40, 29, -2), W - 2 * PAD - 40, 3)
        end = paragraph(draw, (PAD + 36, y), lines, font, INK, 1.2)
        if small:
            draw.text((PAD + 36, end + 4), small, font=sans(26, 400), fill=MUTED)
        y += space
    footer(draw, index, total, dark=False)
    return im


def tally_slide(index: int, total: int, label: str, heading: str, cells: list, note: str) -> Image.Image:
    """A light slide with a grid of big numbers: [(number, caption), ...] (2 per row)"""
    im = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, W, 12), fill=SPARK)
    masthead(im, draw, dark=False)
    pill(draw, (PAD, 210), label, SOFT, BRAND)
    font, lines = fit(draw, heading, lambda s: serif(s, 500), range(62, 43, -2), W - 2 * PAD, 2)
    y = paragraph(draw, (PAD, 300), lines, font, INK, 1.14) + 34
    gap = 24
    cell_w = (W - 2 * PAD - gap) // 2
    rows = (len(cells) + 1) // 2
    cell_h = min(216, (H - 300 - y) // max(1, rows) - gap)
    for i, (number, caption_text) in enumerate(cells):
        x = PAD + (i % 2) * (cell_w + gap)
        top = y + (i // 2) * (cell_h + gap)
        draw.rounded_rectangle((x, top, x + cell_w, top + cell_h), radius=26, fill=CARD, outline=LINE, width=2)
        draw.text((x + 34, top + 10), str(number), font=serif(84, 500), fill=BRAND)
        small = sans(26, 600)
        paragraph(draw, (x + 34, top + 128), wrap(draw, caption_text, small, cell_w - 68)[:2], small, MUTED, 1.2)
    small = sans(27, 400)
    paragraph(draw, (PAD, y + rows * (cell_h + gap) + 14), wrap(draw, note, small, W - 2 * PAD)[:3], small, MUTED, 1.4)
    footer(draw, index, total, dark=False)
    return im


def title_slide(kicker: str, headline: str, sub: str, total: int) -> Image.Image:
    """The dark cover."""
    im = night_canvas()
    draw = ImageDraw.Draw(im)
    masthead(im, draw, dark=True)
    font = sans(24, 700)
    width = tracked_width(draw, kicker, font, 2.6) + 52
    draw.rounded_rectangle((PAD, 300, PAD + width, 356), radius=28, fill=(18, 62, 54), outline=(44, 96, 86))
    tracked(draw, (PAD + 26, 314), kicker, font, MINT, 2.6)
    font, lines = fit(draw, headline, lambda s: serif(s, 500), range(104, 59, -4), W - 2 * PAD, 7)
    y = paragraph(draw, (PAD, 410), lines, font, (255, 255, 255), 1.08)
    if sub:
        draw.text((PAD, min(y + 36, H - 250)), sub, font=serif(40, 400, italic=True), fill=MINT)
    draw.text((PAD, H - 108), "Swipe for the takeaways  →", font=sans(29, 600), fill=MINT)
    footer_dots_only(draw, 0, total, dark=True)
    return im


def closing(total: int, big=("Read the full", "briefing."), small=("Sources, summaries", "and the fine print."),
            address: str = f"{SITE}/blog") -> Image.Image:
    im = night_canvas()
    draw = ImageDraw.Draw(im)
    masthead(im, draw, dark=True)

    y = paragraph(draw, (PAD, 330), list(big), serif(108, 500), (255, 255, 255), 1.06)
    y = paragraph(draw, (PAD, y + 26), list(small), serif(54, 400, italic=True), MINT, 1.2)

    draw.rounded_rectangle((PAD, y + 60, W - PAD, y + 190), radius=65, fill=MINT)
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
    lines += [
        "",
        f"Full summaries and links to every source: {SITE}/blog?date={post['date']} (link in bio).",
        "",
        f"Follow {HANDLE} for three briefings a week on AI in medicine.",
        "",
        DISCLAIMER,
        "",
        hashtags(post.get("tags", []), ["#AIinMedicine", "#MedEd", "#MedicalEducation", "#DigitalHealth"]),
    ]
    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------- writing a carousel

DISCLAIMER = "AI-drafted and reviewed by clinicians before publishing. Always check the original source. Not medical advice."


def hashtags(extra: list[str], base: list[str]) -> str:
    tags = list(base)
    for tag in extra:
        made = hashtag(tag)
        if made and made.lower() not in {t.lower() for t in tags} and len(tags) < 10:
            tags.append(made)
    return " ".join(tags)


def save_carousel(out: Path, slides: list, caption_text: str, marker: str) -> list[Path]:
    assert marker in caption_text, "the marker has to be in the caption"
    assert 2 <= len(slides) <= 10, "a carousel holds 2 to 10 slides"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.jpg"):
        old.unlink()
    paths = []
    for n, slide in enumerate(slides, 1):
        path = out / f"{n:02d}.jpg"
        slide.convert("RGB").save(path, "JPEG", quality=90, optimize=True)
        paths.append(path)
    (out / "caption.txt").write_text(caption_text.strip() + "\n", encoding="utf-8")
    (out / "marker.txt").write_text(marker + "\n", encoding="utf-8")
    return paths


def build(post: dict, out: Path) -> list[Path]:
    """A blog post."""
    items = post["items"][:MAX_ITEM_SLIDES]
    total = len(items) + 2
    count = len(post["items"])
    kinds = " + ".join({"med_ed": "Med-ed review", "ai_vs_human": "AI vs human"}.get(i.get("section"), "Review")
                       for i in post["items"][:2]) if count <= 2 else f"{count} reviews"
    slides = [title_slide(f"BRIEFING  ·  {long_date(post['date']).upper()}", post["headline"], kinds, total),
              *(item_slide(item, i + 1, total) for i, item in enumerate(items)),
              closing(total)]
    return save_carousel(out, slides, caption(post), f"blog?date={post['date']}")


def build_digest(d: dict, out: Path) -> list[Path]:
    """The weekly digest, from the same data as the email (newsletter.build)."""
    start, end = d["start"], d["end"]
    span = f"{start.strftime('%b')} {start.day} – {end.strftime('%b')} {end.day}"
    inner = []
    if d.get("one_thing"):
        item = d["one_thing"]
        inner.append(lambda i, n, item=item: card_slide(i, n, [("THE ONE THING", SOFT, BRAND)], item["title"],
                                                        str(item.get("source", "")), "WHY IT MATTERS", item.get("why_it_matters", "")))
    for item in d.get("versus", [])[:1]:
        inner.append(lambda i, n, item=item: card_slide(i, n, item_labels(item), item["title"],
                                                        str(item.get("source", "")), "WHY IT MATTERS", item.get("why_it_matters", "")))
    also = d.get("also", [])[:4]
    if also:
        inner.append(lambda i, n: list_slide(i, n, "ALSO THIS WEEK", "Worth a look", [(o["title"], str(o.get("source", ""))) for o in also]))
    tool = d.get("tool")
    if tool:
        inner.append(lambda i, n: card_slide(i, n, [("TOOL OF THE WEEK", SOFT, BRAND)], tool["title"], "Built by a member",
                                             "WHAT IT DOES", " ".join(str(tool.get("description") or "").split())))
    if not inner:
        return []
    total = len(inner) + 2
    headline = (d.get("one_thing") or {}).get("title") or "The week in AI and medicine"
    slides = [title_slide(f"THE WEEK  ·  {span.upper()}", "The week in AI and medicine", "A two-minute recap", total),
              *(make(i + 1, total) for i, make in enumerate(inner)),
              closing(total, ("Catch up on", "the week."), ("Every briefing,", "with its sources."))]
    marker = f"Week ending {end.isoformat()}"
    lines = [f"The week in AI and medicine, {span}.", "", f"The one thing: {headline}"]
    for item in d.get("versus", [])[:1]:
        lines.append(f"AI vs human: {item['title']} ({VERDICT_LABELS.get(item.get('verdict'), 'result').lower()})")
    for other in also:
        lines.append(f"Also: {other['title']}")
    if tool:
        lines.append(f"Tool of the week: {tool['title']}")
    lines += ["", f"Every briefing with its sources: {SITE}/blog (link in bio). {marker}.", "",
              f"Follow {HANDLE} for three briefings a week on AI in medicine.", "", DISCLAIMER, "",
              hashtags([], ["#AIinMedicine", "#MedEd", "#MedicalEducation", "#DigitalHealth", "#WeekInReview"])]
    return save_carousel(out, slides, "\n".join(lines), marker)


def build_review(review: dict, out: Path) -> list[Path]:
    """An edition of the living review "AI vs Human" (evidence/ai-vs-human.json)."""
    import re
    plain = lambda text: re.sub(r"\s*\[S\d+\]", "", str(text)).strip()
    studies = review.get("studies", [])
    count = lambda *verdicts: sum(1 for s in studies if s.get("verdict") in verdicts)
    findings = [plain(f) for f in review.get("key_findings", [])][:5]
    if not findings:
        return []
    total = len(findings) + 3
    edition, updated = review.get("edition", 1), review["updated"]
    month = dt.date.fromisoformat(updated).strftime("%B %Y")
    slides = [
        title_slide(f"AI VS HUMAN  ·  EDITION {edition}", "How AI is changing what physicians can do",
                    f"{len(studies)} studies, weighed. {month}.", total),
        tally_slide(1, total, "THE EVIDENCE SO FAR", f"{len(studies)} studies, by how they came out", [
            (count("ai_ahead"), "AI ahead of clinicians"),
            (count("humans_ahead"), "Clinicians ahead of AI"),
            (count("ai_help_improved"), "AI help improved clinicians"),
            (count("ai_help_no_benefit", "ai_help_harmed"), "AI help: no gain, or worse"),
            (count("comparable"), "Comparable"),
            (count("mixed"), "Mixed results"),
        ], "A count of studies, not a score: they differ in size, design and how close they are to real practice."),
        *(card_slide(i + 2, total, [(f"FINDING {i + 1} OF {len(findings)}", SOFT, BRAND)], "What the studies show", "",
                     "KEY FINDING", finding) for i, finding in enumerate(findings)),
        closing(total, ("Read the", "evidence."), ("Every study,", "with its source."), f"{SITE}/ai-vs-human"),
    ]
    marker = f"AI vs Human, edition {edition}"
    lines = [f"{marker}: how AI is changing what physicians can do.", "", plain(review.get("summary", "")), "",
             f"The full paper, with every study and its source: {SITE}/ai-vs-human (link in bio).", "",
             f"Follow {HANDLE} for three briefings a week on AI in medicine.", "",
             "A summary of published research, drafted by AI and reviewed by clinicians. Not medical advice.", "",
             hashtags([], ["#AIinMedicine", "#MedEd", "#EvidenceBasedMedicine", "#DigitalHealth", "#ClinicalAI"])]
    return save_carousel(out, slides, "\n".join(lines), marker)


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

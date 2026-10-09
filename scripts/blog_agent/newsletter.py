"""Assemble the weekly digest: a two-minute read with a fixed shape.

  1. The one thing        the week's most useful item, in two sentences
  2. AI vs human          this week's head-to-head result and the running tally
  3. Tool of the week     one tool from the hub
  4. From the Collective  who published what (public part; the members-only
                          part is added when an admin sends it)
  5. One ask              a single thing to do this week

Writes newsletter/YYYY-MM-DD.html (email-ready, inline styles), .txt (plain
text) and .json (the suggested subject line). No AI call: it only rearranges
posts that were already reviewed and merged, and reads published projects
from the site's public API (the same request the home page makes; if that
fails, those parts are left out). The weekly workflow
(.github/workflows/weekly-newsletter.yml) publishes the result to the site; an
admin then sends it from the Moderation page.

The files carry three markers that the Moderation page fills in at the moment
an admin presses send (see initDigestSender in auth.js): a personal note,
members-only news (meeting, most-wanted request, new members), and the ask.
The web copy simply shows nothing there.

Usage:
    python scripts/blog_agent/newsletter.py [--date YYYY-MM-DD] [--days 7]
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
POSTS_DIR = ROOT / "blog" / "posts"
OUT_DIR = ROOT / "newsletter"
SITE_URL = "https://www.aimedicinecollective.com"

# Public by design (see CLAUDE.md): the same address and publishable key the
# site's own pages use. They can only read what signed-out visitors can.
API_URL = "https://ahwnarhmuzxgjindreuz.supabase.co/rest/v1"
API_KEY = "sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT"

# Markers the Moderation page replaces when the digest is sent. Keep these
# three strings identical to the ones in auth.js.
MARK_NOTE = "<!--AMC:NOTE-->"
MARK_COLLECTIVE = "<!--AMC:COLLECTIVE-->"
MARK_ASK_OPEN, MARK_ASK_CLOSE = "<!--AMC:ASK-->", "<!--/AMC:ASK-->"
TEXT_NOTE, TEXT_COLLECTIVE = "[[AMC:NOTE]]", "[[AMC:COLLECTIVE]]"
TEXT_ASK_OPEN, TEXT_ASK_CLOSE = "[[AMC:ASK]]", "[[/AMC:ASK]]"

# Email design, matching the site's light look: white card on pale grey, a
# dark-green masthead, serif headlines, deep-green links. Everything is inline
# and laid out with tables, because email clients drop <style> and most of
# modern CSS. Web fonts do not load in most mail apps, so the serif falls back
# to Georgia. The Moderation page adds the note and members-only news with
# matching styles (DIGEST_P and DIGEST_LINK in auth.js): keep them in step.
PAGE, CARD, NIGHT, INK, BODY, MUTED, LINE = (
    "#f1f4f8", "#ffffff", "#05261f", "#0f172a", "#334155", "#64748b", "#e5e9f0")
BRAND, SPARK, MINT, SOFT, SKY, SKY_INK, AMBER_BG, AMBER_INK = (
    "#0b6b4f", "#10b981", "#6ee7b7", "#ecf7f2", "#e0f2fe", "#075985", "#fef3c7", "#92400e")
SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Consolas, Menlo, 'Courier New', monospace"
P = f"margin:0 0 12px;font-family:{SANS};font-size:16px;line-height:1.6;color:{BODY};"
LABEL = (f"margin:0 0 12px;font-family:{MONO};font-size:11px;font-weight:bold;letter-spacing:2px;"
         f"color:{BRAND};text-transform:uppercase;")
LINK = f"color:{BRAND};text-decoration:none;font-weight:bold;"
RULE = f'<hr style="border:0;border-top:1px solid {LINE};margin:28px 0;">'

VERDICTS = {
    "ai_ahead": "AI ahead",
    "humans_ahead": "Humans ahead",
    "comparable": "Comparable",
    "mixed": "Mixed results",
}
DEFAULT_ASK = "Open one tool from the hub this week and tell its author what you think."


def today_eastern() -> dt.date:
    """Today's date in US Eastern time (falls back to the machine's local date
    where no time zone database is installed, e.g. some Windows setups)."""
    try:
        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except ZoneInfoNotFoundError:
        return dt.date.today()


def short(text: str, limit: int = 160) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def all_posts(through: dt.date) -> list[dict]:
    posts = []
    for path in sorted(POSTS_DIR.glob("*.json")):
        try:
            post_date = dt.date.fromisoformat(path.stem)
        except ValueError:
            continue
        if post_date <= through:
            posts.append(json.loads(path.read_text(encoding="utf-8")))
    return posts


def api(path: str, query: dict) -> list[dict]:
    """One read from the public API. Empty list on any failure."""
    url = f"{API_URL}/{path}?{urllib.parse.urlencode(query)}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"apikey": API_KEY}), timeout=20) as response:
            rows = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        print(f"Could not read {path} ({err}); leaving that part out.")
        return []
    return [row for row in rows if isinstance(row, dict)]


def published_tools() -> list[dict]:
    return [row for row in api("projects", {
        "select": "id,title,category,description,link_url,created_at,author:profiles!projects_author_id_fkey(full_name)",
        "kind": "eq.project",
        "status": "eq.published",
        "order": "title.asc",
        "limit": "200",
    }) if row.get("title")]


# ---------------------------------------------------------------- content

def build(end: dt.date, days: int) -> dict:
    start = end - dt.timedelta(days=days - 1)
    posts = all_posts(end)
    week = [p for p in posts if dt.date.fromisoformat(p["date"]) >= start]

    def tagged(post, item):
        return {**item, "post_date": post["date"]}

    week_items = [tagged(p, i) for p in reversed(week) for i in p.get("items", [])]   # newest first
    versus_week = [i for i in week_items if i.get("section") == "ai_vs_human"]
    others = [i for i in week_items if i.get("section") != "ai_vs_human"]
    one_thing = others[0] if others else (week_items[0] if week_items else None)
    also = [i for i in week_items if i is not one_thing and i not in versus_week]

    # Running tally over every head-to-head review published so far
    tally = {"ai_ahead": 0, "humans_ahead": 0, "comparable": 0, "mixed": 0}
    for post in posts:
        for item in post.get("items", []):
            if item.get("section") == "ai_vs_human" and item.get("verdict") in tally:
                tally[item["verdict"]] += 1

    tools = published_tools()
    window_start = dt.datetime.combine(start, dt.time.min).isoformat()
    window_end = dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min).isoformat()
    new_tools = [t for t in tools if window_start <= str(t.get("created_at", ""))[:19] < window_end]
    launchable = [t for t in tools if str(t.get("link_url") or "").startswith("https://")]
    tool = launchable[end.isocalendar().week % len(launchable)] if launchable else None

    # "Hamza published X" — grouped, so one busy author doesn't fill the email
    by_author: dict[str, list[str]] = {}
    for t in new_tools:
        name = ((t.get("author") or {}).get("full_name") or "A member").strip()
        by_author.setdefault(name, []).append(t["title"])
    published_lines = []
    for name, titles in by_author.items():
        if len(titles) == 1:
            published_lines.append(f"{name} published {titles[0]}.")
        elif len(titles) <= 3:
            published_lines.append(f"{name} published {', '.join(titles[:-1])} and {titles[-1]}.")
        else:
            published_lines.append(f"{name} added {len(titles)} tools, including {titles[0]} and {titles[1]}.")

    headline = week[-1]["headline"] if week else (f"New in the hub: {new_tools[0]['title']}" if new_tools else "")
    return {
        "start": start, "end": end, "week": week, "one_thing": one_thing, "versus": versus_week,
        "also": also, "tally": tally, "tool": tool, "published_lines": published_lines,
        "subject": short(headline, 90) or f"AI Medicine Collective: week ending {end.isoformat()}",
    }


# ---------------------------------------------------------------- HTML

def render_html(d: dict) -> str:
    e = html.escape
    start, end, tally = d["start"], d["end"], d["tally"]

    def pill(text: str, background: str, color: str) -> str:
        return (f'<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:{background};'
                f'font-family:{SANS};font-size:12px;font-weight:bold;letter-spacing:0.5px;color:{color};">{text}</span>')

    def button(text: str, href: str) -> str:
        return (f'<a href="{href}" style="display:inline-block;padding:11px 22px;border-radius:999px;background:{BRAND};'
                f'font-family:{SANS};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">{text}</a>')

    out = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<meta name="color-scheme" content="light">',
        f"<title>{e(d['subject'])}</title></head>",
        f'<body style="margin:0;background:{PAGE};">',
        f'<div style="display:none;max-height:0;overflow:hidden;">{e(short((d["one_thing"] or {}).get("why_it_matters", ""), 120))}</div>',
        f'<div style="background:{PAGE};padding:28px 12px;">',
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;margin:0 auto;background:{CARD};border:1px solid {LINE};border-radius:16px;overflow:hidden;">',
        # masthead: a bright strip, then the name on dark green
        f'<tr><td style="height:4px;line-height:4px;font-size:0;background:{SPARK};'
        f'background-image:linear-gradient(90deg,{SPARK},#06b6d4);">&nbsp;</td></tr>',
        f'<tr><td style="padding:26px 32px 24px;background:{NIGHT};">',
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>',
        f'<td style="padding-right:12px;vertical-align:middle;"><img src="{SITE_URL}/images/icon-192.png" width="40" height="40" '
        'alt="AMC" style="display:block;border:0;border-radius:10px;"></td>',
        f'<td style="vertical-align:middle;font-family:{SANS};font-size:15px;font-weight:bold;letter-spacing:1px;color:#ffffff;">'
        "AI MEDICINE COLLECTIVE</td>",
        "</tr></table>",
        f'<p style="margin:22px 0 0;font-family:{SERIF};font-size:34px;line-height:1.05;font-weight:500;letter-spacing:-0.5px;color:#ffffff;">'
        f'The weekly <em style="font-style:italic;color:{MINT};">digest</em></p>',
        f'<p style="margin:10px 0 0;font-family:{MONO};font-size:11px;letter-spacing:2px;color:{MINT};">'
        f'{e(start.strftime("%b %d").upper())} &ndash; {e(end.strftime("%b %d, %Y").upper())} &nbsp;&middot;&nbsp; A TWO-MINUTE READ</p>',
        "</td></tr>",
        '<tr><td style="padding:30px 32px 28px;">',
        MARK_NOTE,
    ]

    item = d["one_thing"]
    if item:
        out += [
            f'<p style="{LABEL}">The one thing</p>',
            f'<p style="margin:0 0 12px;font-family:{SERIF};font-size:27px;line-height:1.18;font-weight:500;letter-spacing:-0.4px;">'
            f'<a href="{e(item["url"])}" style="color:{INK};text-decoration:none;">{e(item["title"])}</a></p>',
            f'<p style="{P}font-size:17px;">{e(item["why_it_matters"])}</p>',
            f'<p style="margin:0;font-family:{SANS};font-size:13px;color:{MUTED};">{e(item["source"])} &nbsp;&middot;&nbsp; '
            f'<a href="{SITE_URL}/blog.html?date={e(item["post_date"])}" style="{LINK}">Read our summary &rarr;</a></p>',
            RULE,
        ]

    # AI vs human: this week's result, then the season tally
    out.append(f'<p style="{LABEL}">AI vs human</p>')
    for versus in d["versus"]:
        verdict = VERDICTS.get(versus.get("verdict"), "Result")
        out += [
            f'<p style="margin:0 0 12px;">{pill("This week: " + e(verdict), SKY, SKY_INK)}</p>',
            f'<p style="margin:0 0 10px;font-family:{SERIF};font-size:21px;line-height:1.25;font-weight:500;letter-spacing:-0.2px;">'
            f'<a href="{e(versus["url"])}" style="color:{INK};text-decoration:none;">{e(versus["title"])}</a></p>',
            f'<p style="{P}">{e(versus["why_it_matters"])}</p>',
        ]
    if not d["versus"]:
        out.append(f'<p style="{P}">No head-to-head study made the cut this week.</p>')

    def cell(number: int, label: str, last: bool = False) -> str:
        edge = "" if last else f"border-right:1px solid {LINE};"
        return (f'<td width="33%" style="padding:18px 6px 16px;text-align:center;{edge}">'
                f'<div style="font-family:{SERIF};font-size:36px;line-height:1;font-weight:500;color:{BRAND};">{number}</div>'
                f'<div style="margin-top:8px;font-family:{MONO};font-size:10px;font-weight:bold;letter-spacing:1.5px;color:{MUTED};">{label}</div></td>')

    if sum(tally.values()):
        out += [
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="margin:16px 0 10px;background:#f8fafc;border:1px solid {LINE};border-radius:12px;"><tr>',
            cell(tally["ai_ahead"], "AI AHEAD"),
            cell(tally["humans_ahead"], "HUMANS AHEAD"),
            cell(tally["comparable"] + tally["mixed"], "EVEN OR MIXED", last=True),
            "</tr></table>",
            f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.5;color:{MUTED};">'
            "Running tally of the head-to-head studies we've reviewed. One study never settles it.</p>",
        ]
    else:
        out.append(f'<p style="{P}">The scoreboard opens with our first head-to-head review: '
                   "each post now pits AI against humans on one medical task.</p>")

    if d["also"]:
        out += [RULE, f'<p style="{LABEL}">Also this week</p>']
        for other in d["also"][:4]:
            out.append(
                f'<p style="margin:0 0 10px;padding-left:14px;border-left:3px solid {LINE};font-family:{SANS};font-size:15px;line-height:1.45;color:{BODY};">'
                f'<a href="{e(other["url"])}" style="{LINK}">{e(other["title"])}</a> '
                f'<span style="color:{MUTED};">({e(other["source"])})</span></p>')

    tool = d["tool"]
    if tool:
        out += [
            RULE,
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background:{SOFT};border-radius:14px;"><tr><td style="padding:24px 24px 22px;">',
            f'<p style="{LABEL}">Tool of the week</p>',
            f'<p style="margin:0 0 8px;font-family:{SERIF};font-size:22px;line-height:1.2;font-weight:500;letter-spacing:-0.2px;">'
            f'<a href="{SITE_URL}/hub.html?project={urllib.parse.quote(str(tool["id"]))}" style="color:{INK};text-decoration:none;">{e(tool["title"])}</a></p>',
            f'<p style="{P}margin-bottom:18px;">{e(short(tool.get("description"), 200))}</p>',
            f'<p style="margin:0;">{button("Open all tools", SITE_URL + "/tools.html")}</p>',
            "</td></tr></table>",
        ]

    out += [RULE, f'<p style="{LABEL}">From the Collective</p>']
    for line in d["published_lines"]:
        out.append(f'<p style="{P}">{e(line)}</p>')
    out.append(MARK_COLLECTIVE)
    if not d["published_lines"]:
        out.append(f'<p style="{P}">See what members are building in the '
                   f'<a href="{SITE_URL}/hub.html" style="{LINK}">Projects hub</a>.</p>')

    out += [
        RULE,
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="border:1px solid {LINE};border-left:4px solid {SPARK};border-radius:12px;"><tr><td style="padding:20px 22px 10px;">',
        f'<p style="{LABEL}">One ask</p>',
        f'{MARK_ASK_OPEN}<p style="{P}">{e(DEFAULT_ASK)} '
        f'<a href="{SITE_URL}/tools.html" style="{LINK}">Open tools</a></p>{MARK_ASK_CLOSE}',
        "</td></tr></table>",
        "</td></tr>",
        # footer
        f'<tr><td style="padding:22px 32px 26px;background:#f8fafc;border-top:1px solid {LINE};">',
        f'<p style="margin:0 0 8px;font-family:{SANS};font-size:13px;line-height:1.55;color:{MUTED};">'
        f'Every briefing: <a href="{SITE_URL}/blog.html" style="{LINK}">aimedicinecollective.com/blog</a>. '
        "Summaries are AI-drafted and reviewed by the Collective before publishing; always check the original source.</p>",
        f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.55;color:{MUTED};">'
        'You get this as a member. Reply to this email to reach us. To stop it, untick "Email me the weekly digest" '
        f'under Your profile on your <a href="{SITE_URL}/account.html#profile" style="{LINK}">account page</a>.</p>',
        "</td></tr></table></div>",
        "</body></html>",
    ]
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- plain text

def render_text(d: dict) -> str:
    start, end, tally = d["start"], d["end"], d["tally"]
    lines = [
        ":: AI MEDICINE COLLECTIVE ::",
        f"Weekly digest, {start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}",
        "",
        TEXT_NOTE,
    ]
    item = d["one_thing"]
    if item:
        lines += ["// THE ONE THING", item["title"], item["why_it_matters"], item["url"], ""]
    lines.append("// AI VS HUMAN")
    for versus in d["versus"]:
        lines += [f"This week: {VERDICTS.get(versus.get('verdict'), 'Result')}", versus["title"],
                  versus["why_it_matters"], versus["url"]]
    if not d["versus"]:
        lines.append("No head-to-head study made the cut this week.")
    if sum(tally.values()):
        lines.append(f"Running tally: AI ahead {tally['ai_ahead']}, humans ahead {tally['humans_ahead']}, "
                     f"even or mixed {tally['comparable'] + tally['mixed']}.")
    lines.append("")
    if d["also"]:
        lines.append("// ALSO THIS WEEK")
        for other in d["also"][:4]:
            lines += [f"> {other['title']} ({other['source']})", f"  {other['url']}"]
        lines.append("")
    tool = d["tool"]
    if tool:
        lines += ["// TOOL OF THE WEEK", tool["title"], short(tool.get("description"), 200),
                  f"{SITE_URL}/hub.html?project={tool['id']}", ""]
    lines.append("// FROM THE COLLECTIVE")
    lines += d["published_lines"]
    lines += [TEXT_COLLECTIVE, ""]
    lines += ["// ONE ASK", f"{TEXT_ASK_OPEN}{DEFAULT_ASK} {SITE_URL}/tools.html{TEXT_ASK_CLOSE}", ""]
    lines += [
        f"Every briefing: {SITE_URL}/blog.html",
        "Summaries are AI-drafted and reviewed by the Collective before publishing; always check the original source.",
        "",
        "You get this as a member. Reply to this email to reach us. To stop it, untick "
        f"\"Email me the weekly digest\" under Your profile on your account page: {SITE_URL}/account.html#profile",
    ]
    return "\n".join(lines) + "\n"


def set_output(name: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")
    print(f"{name}={value}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Defaults to today (US Eastern)")
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()

    end = args.date or today_eastern()
    set_output("date", end.isoformat())
    digest = build(end, args.days)
    if not digest["week"] and not digest["published_lines"]:
        print("No published posts or new projects this week; no newsletter.")
        set_output("created", "false")
        return 0

    OUT_DIR.mkdir(exist_ok=True)
    stem = OUT_DIR / end.isoformat()
    stem.with_suffix(".html").write_text(render_html(digest), encoding="utf-8")
    stem.with_suffix(".txt").write_text(render_text(digest), encoding="utf-8")
    stem.with_suffix(".json").write_text(
        json.dumps({"date": end.isoformat(), "subject": digest["subject"]}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")
    # The Moderation page reads this to offer the newest issue
    (OUT_DIR / "latest.json").write_text(json.dumps({"date": end.isoformat()}) + chr(10), encoding="utf-8")
    print(f"Wrote {stem.name}.html, .txt and .json from {len(digest['week'])} post(s). Subject: {digest['subject']}")
    set_output("created", "true")
    set_output("post_count", str(len(digest["week"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

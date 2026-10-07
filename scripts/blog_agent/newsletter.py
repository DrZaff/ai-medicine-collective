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
(.github/workflows/weekly-newsletter.yml) opens a pull request with the result.

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

# Email design. Inline because email clients drop <style>. Same idea as the
# site: green monospace for the frame and labels, near-white plain text for
# anything people read.
BG, PANEL, GREEN, ACCENT, BODY, MUTED, YELLOW, CYAN = (
    "#000000", "#050b06", "#00ff66", "#00cc55", "#e9f1eb", "#9db8a6", "#ffe600", "#00e5ff")
MONO = "'Courier New', Courier, monospace"
SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
P = f"margin:0 0 10px;font-family:{SANS};font-size:16px;line-height:1.55;color:{BODY};"
LABEL = f"margin:26px 0 10px;font-family:{MONO};font-size:12px;letter-spacing:2px;color:{ACCENT};text-transform:uppercase;"
LINK = f"color:{GREEN};text-decoration:none;font-weight:bold;"

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
    out = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f"<title>{e(d['subject'])}</title></head>",
        f'<body style="margin:0;background:{BG};">',
        f'<div style="display:none;max-height:0;overflow:hidden;">{e(short((d["one_thing"] or {}).get("why_it_matters", ""), 120))}</div>',
        f'<div style="background:{BG};padding:24px 12px;">',
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;margin:0 auto;background:{PANEL};border:1px solid {ACCENT};">',
        '<tr><td style="padding:26px 24px 22px;">',
        f'<p style="margin:0;text-align:center;font-family:{MONO};font-size:20px;font-weight:bold;letter-spacing:2px;color:{GREEN};">'
        ":: AI MEDICINE COLLECTIVE ::</p>",
        f'<p style="margin:6px 0 0;text-align:center;font-family:{MONO};font-size:12px;letter-spacing:1px;color:{MUTED};">'
        f'WEEKLY DIGEST &middot; {e(start.strftime("%b %d").upper())} &ndash; {e(end.strftime("%b %d, %Y").upper())}</p>',
        f'<hr style="border:0;border-top:1px dashed {ACCENT};margin:18px 0 4px;">',
        MARK_NOTE,
    ]

    item = d["one_thing"]
    if item:
        out += [
            f'<p style="{LABEL}">// The one thing</p>',
            f'<p style="margin:0 0 8px;font-family:{SANS};font-size:20px;line-height:1.3;font-weight:bold;">'
            f'<a href="{e(item["url"])}" style="color:{GREEN};text-decoration:none;">{e(item["title"])}</a></p>',
            f'<p style="{P}">{e(item["why_it_matters"])}</p>',
            f'<p style="margin:0;font-family:{MONO};font-size:12px;color:{MUTED};">{e(item["source"])} &middot; '
            f'<a href="{SITE_URL}/blog.html?date={e(item["post_date"])}" style="color:{MUTED};">our summary</a></p>',
        ]

    # AI vs human: this week's result, then the season tally
    out.append(f'<p style="{LABEL}">// AI vs human</p>')
    for versus in d["versus"]:
        verdict = VERDICTS.get(versus.get("verdict"), "Result")
        out += [
            f'<p style="margin:0 0 6px;"><span style="display:inline-block;padding:3px 10px;border:1px solid {YELLOW};'
            f'border-radius:999px;font-family:{MONO};font-size:12px;letter-spacing:1px;color:{YELLOW};">'
            f"THIS WEEK: {e(verdict.upper())}</span></p>",
            f'<p style="margin:0 0 6px;font-family:{SANS};font-size:17px;line-height:1.35;font-weight:bold;">'
            f'<a href="{e(versus["url"])}" style="color:{CYAN};text-decoration:none;">{e(versus["title"])}</a></p>',
            f'<p style="{P}">{e(versus["why_it_matters"])}</p>',
        ]
    if not d["versus"]:
        out.append(f'<p style="{P}">No head-to-head study made the cut this week.</p>')
    def cell(number: int, label: str) -> str:
        return (f'<td width="33%" style="padding:12px 6px;text-align:center;border:1px solid #14301c;">'
                f'<div style="font-family:{MONO};font-size:30px;font-weight:bold;color:{GREEN};">{number}</div>'
                f'<div style="font-family:{MONO};font-size:11px;letter-spacing:1px;color:{MUTED};">{label}</div></td>')

    if sum(tally.values()):
        out += [
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border-collapse:collapse;"><tr>',
            cell(tally["ai_ahead"], "AI AHEAD"),
            cell(tally["humans_ahead"], "HUMANS AHEAD"),
            cell(tally["comparable"] + tally["mixed"], "EVEN OR MIXED"),
            "</tr></table>",
            f'<p style="margin:0;font-family:{MONO};font-size:11px;color:{MUTED};">'
            "Running tally of the head-to-head studies we've reviewed. One study never settles it.</p>",
        ]
    else:
        out.append(f'<p style="{P}">The scoreboard opens with our first head-to-head review: '
                   "each post now pits AI against humans on one medical task.</p>")

    if d["also"]:
        out.append(f'<p style="{LABEL}">// Also this week</p>')
        for other in d["also"][:4]:
            out.append(
                f'<p style="margin:0 0 8px;font-family:{SANS};font-size:15px;line-height:1.4;color:{BODY};">'
                f'&gt; <a href="{e(other["url"])}" style="{LINK}">{e(other["title"])}</a> '
                f'<span style="color:{MUTED};">({e(other["source"])})</span></p>')

    tool = d["tool"]
    if tool:
        out += [
            f'<p style="{LABEL}">// Tool of the week</p>',
            f'<p style="margin:0 0 6px;font-family:{SANS};font-size:17px;font-weight:bold;">'
            f'<a href="{SITE_URL}/hub.html?project={urllib.parse.quote(str(tool["id"]))}" style="color:{GREEN};text-decoration:none;">{e(tool["title"])}</a></p>',
            f'<p style="{P}">{e(short(tool.get("description"), 200))}</p>',
            f'<p style="margin:0;font-family:{MONO};font-size:13px;"><a href="{SITE_URL}/tools.html" style="{LINK}">&gt; OPEN ALL TOOLS</a></p>',
        ]

    out.append(f'<p style="{LABEL}">// From the Collective</p>')
    for line in d["published_lines"]:
        out.append(f'<p style="{P}">{e(line)}</p>')
    out.append(MARK_COLLECTIVE)
    if not d["published_lines"]:
        out.append(f'<p style="{P}">See what members are building in the '
                   f'<a href="{SITE_URL}/hub.html" style="{LINK}">Projects hub</a>.</p>')

    out += [
        f'<p style="{LABEL}">// One ask</p>',
        f'{MARK_ASK_OPEN}<p style="{P}">{e(DEFAULT_ASK)} '
        f'<a href="{SITE_URL}/tools.html" style="{LINK}">Open tools</a></p>{MARK_ASK_CLOSE}',
        f'<hr style="border:0;border-top:1px dashed {ACCENT};margin:24px 0 14px;">',
        f'<p style="margin:0 0 8px;font-family:{SANS};font-size:13px;line-height:1.5;color:{MUTED};">'
        f'Every briefing: <a href="{SITE_URL}/blog.html" style="color:{GREEN};">aimedicinecollective.com/blog</a>. '
        "Summaries are AI-drafted and reviewed by the Collective before publishing; always check the original source.</p>",
        f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.5;color:{MUTED};">'
        'You get this as a member. Reply to this email to reach us. To stop it, untick "Email me the weekly digest" '
        f'under Your profile on your <a href="{SITE_URL}/account.html#profile" style="color:{GREEN};">account page</a>.</p>',
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
    print(f"Wrote {stem.name}.html, .txt and .json from {len(digest['week'])} post(s). Subject: {digest['subject']}")
    set_output("created", "true")
    set_output("post_count", str(len(digest["week"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

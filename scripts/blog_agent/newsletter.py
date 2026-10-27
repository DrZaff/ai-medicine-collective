"""Assemble the weekly digest: a two-minute read with a fixed shape.

  1. The one thing        the week's most useful item, in two sentences
  2. AI vs physician      the week's strongest head-to-head study (others go to 'Also')
  3. Tool of the week     one tool from the hub
  4. From the Collective  who published what (public part; the members-only
                          part is added when an admin sends it)
  5. One ask              a single thing to do this week (a different one each week)

Writes newsletter/YYYY-MM-DD.html (email-ready, inline styles), .txt (plain
text), .json (the suggested subject line) and .leads.json (the same issue
built around each of the week's items as the lead story, so the sender can
pick a different lead on the Moderation page). No AI call: it only rearranges
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
import re
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

# Email design: a traditional printed newsletter. Warm paper, one calm column,
# a centred masthead between rules, serif text set large with generous line
# spacing, and a single deep green used only for links and small labels.
# Everything is inline and laid out with tables, because email clients drop
# <style> and most of modern CSS. Web fonts do not load in most mail apps, so
# the serif is Georgia, which every device has. The Moderation page adds the
# note and members-only news with matching styles (DIGEST_P and DIGEST_LINK in
# auth.js): keep them in step.
DESK, PAPER, INK, BODY, MUTED, RULE_COLOR, GREEN, TINT = (
    "#efeae0", "#fffdf8", "#1c2420", "#333b36", "#7b766a", "#ddd5c5", "#0b5d45", "#f4f0e6")
SERIF = "Georgia, 'Times New Roman', Times, serif"
SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
P = f"margin:0 0 14px;font-family:{SERIF};font-size:17px;line-height:1.7;color:{BODY};"
LABEL = (f"margin:0 0 14px;font-family:{SANS};font-size:11px;font-weight:bold;letter-spacing:2.5px;"
         f"color:{GREEN};text-transform:uppercase;")
LINK = f"color:{GREEN};text-decoration:underline;"
RULE = f'<hr style="border:0;border-top:1px solid {RULE_COLOR};margin:34px 0 30px;">'

VERDICTS = {
    "ai_ahead": "AI outperformed physicians",
    "ai_help_improved": "AI helped improve",
    "ai_help_no_benefit": "AI help: no difference",
    "ai_help_harmed": "AI help made it worse",
    "humans_ahead": "Physicians outperformed AI",
    "comparable": "Comparable",
    "mixed": "Mixed results",
}
# The ask changes each week (picked by the week number), so the email does not
# repeat itself. The admin can still replace it when sending.
ASKS = [
    ("Open one tool this week and tell its author what you think.", "/hub.html", "Open tools"),
    ("Send this week's AI vs physician study to a colleague who would argue with it.", "/blog.html", "Read it"),
    ("Wish a tool existed? Post the idea, or vote for someone else's.", "/requests.html", "See requests"),
    ("Built something useful? Add it to the Tools page; a moderator checks it first.", "/hub.html?view=submit", "Add a tool"),
    ("Vote on a time for this month's meeting.", "/schedule.html", "Vote"),
    ("Follow the Collective on Instagram and share one post with someone who would like it.",
     "https://www.instagram.com/aimedicinecollective/", "Follow"),
]


def weekly_ask(end: dt.date) -> tuple[str, str, str]:
    text, href, link_text = ASKS[end.isocalendar().week % len(ASKS)]
    return text, (href if href.startswith("https://") else SITE_URL + href), link_text


def subject_line(headline: str, end: dt.date) -> str:
    """A subject that fits an inbox without being cut off mid-word: the
    headline if short enough, else its first clause, else a plain label."""
    headline = " ".join(str(headline).split())
    if headline and len(headline) <= 90:
        return headline
    for cut in (";", ", and ", ": ", " and "):
        first = headline.split(cut)[0].strip().rstrip(",")
        if 25 <= len(first) <= 90:
            return first
    return f"AI in medicine this week: {end.strftime('%B')} {end.day}"


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

def source_rank(item: dict) -> int:
    """0 for a journal, 1 for a preprint, 2 for news coverage or a press release:
    when picking what to lead with, a primary source wins."""
    source = str(item.get("source", "")).lower()
    if any(word in source for word in ("news", "release", "report", "press", "advisor", "spectator", "auntminnie", "blog")):
        return 2
    if any(word in source for word in ("preprint", "arxiv", "medrxiv", "biorxiv", "ssrn")):
        return 1
    return 0


def build(end: dt.date, days: int, lead_url: str | None = None, tools: list | None = None) -> dict:
    """lead_url: the item to lead with (default: the strongest med-ed item).
    tools: the published tools, if already fetched."""
    start = end - dt.timedelta(days=days - 1)
    posts = all_posts(end)
    week = [p for p in posts if dt.date.fromisoformat(p["date"]) >= start]

    def tagged(post, item):
        return {**item, "post_date": post["date"]}

    week_items = [tagged(p, i) for p in reversed(week) for i in p.get("items", [])]   # newest first
    best = lambda items: min(items, key=lambda i: (source_rank(i), items.index(i))) if items else None
    chosen = [i for i in week_items if lead_url and i.get("url") == lead_url]
    # The default lead: the strongest source of the week (a journal beats a
    # preprint beats news), a med-ed item winning a tie, newest first
    lead_key = lambda i: (source_rank(i), i.get("section") == "ai_vs_human", week_items.index(i))
    one_thing = chosen[0] if chosen else (min(week_items, key=lead_key) if week_items else None)
    # One head-to-head study per issue: the strongest one that isn't the lead
    head_to_head = best([i for i in week_items if i.get("section") == "ai_vs_human" and i is not one_thing])
    versus_week = [head_to_head] if head_to_head else []
    also = [i for i in week_items if i is not one_thing and i is not head_to_head]

    tools = published_tools() if tools is None else tools
    window_start = dt.datetime.combine(start, dt.time.min).isoformat()
    window_end = dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min).isoformat()
    new_tools = [t for t in tools if window_start <= str(t.get("created_at", ""))[:19] < window_end]
    launchable = [t for t in tools if str(t.get("link_url") or "").startswith("https://")]
    # Prefer tools anyone can open in a browser over custom GPTs (which need a
    # paid ChatGPT account) and downloadable files
    def opens_anywhere(t):
        link = str(t.get("link_url") or "").lower()
        return "chatgpt.com" not in link and not re.search(r"\.(xlsx?|docx?|pptx?|pdf)(\?|$)", link)
    pool = [t for t in launchable if opens_anywhere(t)] or launchable
    tool = pool[end.isocalendar().week % len(pool)] if pool else None

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

    headline = week[-1]["headline"] if week else (f"New tool: {new_tools[0]['title']}" if new_tools else "")
    return {
        "start": start, "end": end, "week": week, "items": week_items, "tools": tools,
        "one_thing": one_thing, "versus": versus_week,
        "also": also, "tool": tool, "published_lines": published_lines,
        "subject": subject_line(headline, end),
    }


# ---------------------------------------------------------------- HTML

def render_html(d: dict) -> str:
    e = html.escape
    start, end = d["start"], d["end"]
    item, tool = d["one_thing"], d["tool"]

    def headline(text: str, href: str, size: int) -> str:
        return (f'<p style="margin:0 0 12px;font-family:{SERIF};font-size:{size}px;line-height:1.22;font-weight:normal;color:{INK};">'
                f'<a href="{href}" style="color:{INK};text-decoration:none;">{text}</a></p>')

    def more(text: str, href: str) -> str:
        return (f'<p style="margin:0;font-family:{SANS};font-size:13px;letter-spacing:0.3px;">'
                f'<a href="{href}" style="color:{GREEN};text-decoration:none;font-weight:bold;">{text} &rarr;</a></p>')

    # "In this issue": three short lines that say what is inside
    inside = []
    if item:
        inside.append(short(item["title"], 70))
    if d["versus"]:
        verdict = VERDICTS.get(d["versus"][0].get("verdict"), "the result")
        inside.append(f"AI vs physician: {verdict.lower().replace("ai ", "AI ")}")
    if tool:
        inside.append(f"Tool of the week: {tool['title']}")

    out = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<meta name="color-scheme" content="light">',
        f"<title>{e(d['subject'])}</title></head>",
        f'<body style="margin:0;background:{DESK};">',
        f'<div style="display:none;max-height:0;overflow:hidden;">{e(short((item or {}).get("why_it_matters", ""), 120))}</div>',
        f'<div style="background:{DESK};padding:32px 12px;">',
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:620px;margin:0 auto;background:{PAPER};border:1px solid {RULE_COLOR};">',
        '<tr><td style="padding:40px 44px 36px;">',

        # masthead: the name between rules, as on a printed front page
        f'<p style="margin:0 0 14px;text-align:center;"><img src="{SITE_URL}/images/icon-192.png" width="38" height="38" '
        'alt="AI Medicine Collective" style="border:0;border-radius:9px;"></p>',
        f'<p style="margin:0;text-align:center;font-family:{SANS};font-size:11px;font-weight:bold;letter-spacing:3px;color:{MUTED};">'
        "AI MEDICINE COLLECTIVE</p>",
        f'<p style="margin:10px 0 16px;text-align:center;font-family:{SERIF};font-size:40px;line-height:1.05;font-weight:normal;color:{INK};">'
        "The Weekly Digest</p>",
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="border-top:3px double {INK};border-bottom:1px solid {INK};padding:9px 0;text-align:center;'
        f'font-family:{SANS};font-size:11px;letter-spacing:2px;color:{INK};">'
        f'{e(start.strftime("%B %d").upper())} &ndash; {e(end.strftime("%B %d, %Y").upper())}'
        f' &nbsp;&nbsp;&bull;&nbsp;&nbsp; A TWO-MINUTE READ</td></tr></table>',
    ]

    if inside:
        out.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;background:{TINT};">'
                   f'<tr><td style="padding:18px 22px 8px;">'
                   f'<p style="{LABEL}margin-bottom:10px;">In this issue</p>')
        for number, line in enumerate(inside, 1):
            out.append(f'<p style="margin:0 0 9px;font-family:{SERIF};font-size:16px;line-height:1.45;color:{INK};">'
                       f'<span style="font-style:italic;color:{GREEN};">{number}.</span>&nbsp; {e(line)}</p>')
        out.append("</td></tr></table>")

    out += ['<div style="height:34px;line-height:34px;font-size:0;">&nbsp;</div>', MARK_NOTE]

    if item:
        why = item["why_it_matters"]
        out += [
            f'<p style="{LABEL}">The one thing</p>',
            headline(e(item["title"]), e(item["url"]), 30),
            # a raised first letter, as at the start of a printed article
            f'<p style="{P}font-size:18px;"><span style="float:left;margin:6px 8px 0 0;font-family:{SERIF};font-size:54px;line-height:42px;color:{GREEN};">'
            f'{e(why[:1])}</span>{e(why[1:])}</p>',
            f'<p style="margin:0 0 12px;font-family:{SERIF};font-size:14px;font-style:italic;color:{MUTED};clear:both;">{e(item["source"])}</p>',
            more("Read our summary", f'{SITE_URL}/blog.html?date={e(item["post_date"])}'),
            RULE,
        ]

    # AI vs physician: this week's results
    out.append(f'<p style="{LABEL}">AI vs physician</p>')
    for versus in d["versus"]:
        verdict = VERDICTS.get(versus.get("verdict"), "Result")
        out += [
            headline(e(versus["title"]), e(versus["url"]), 23),
            f'<p style="margin:0 0 12px;font-family:{SERIF};font-size:15px;font-style:italic;color:{GREEN};">This week&rsquo;s result: {e(verdict.lower().replace("ai ", "AI "))}.</p>',
            f'<p style="{P}">{e(versus["why_it_matters"])}</p>',
        ]
    if not d["versus"]:
        out.append(f'<p style="{P}">No head-to-head study made the cut this week. Every study so far is weighed in the '
                   f'<a href="{SITE_URL}/ai-vs-physician.html" style="{LINK}">AI vs Physician paper</a>.</p>')

    if d["also"]:
        out += [RULE, f'<p style="{LABEL}">Also this week</p>']
        for other in d["also"][:4]:
            out.append(
                f'<p style="margin:0 0 14px;font-family:{SERIF};font-size:17px;line-height:1.45;color:{INK};">'
                f'<a href="{e(other["url"])}" style="color:{INK};text-decoration:underline;text-decoration-color:{RULE_COLOR};">{e(other["title"])}</a>'
                f'<br><span style="font-size:14px;font-style:italic;color:{MUTED};">{e(other["source"])}</span></p>')

    if tool:
        out += [
            RULE,
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{TINT};">'
            '<tr><td style="padding:28px 28px 26px;text-align:center;">',
            f'<p style="{LABEL}">Tool of the week</p>',
            f'<p style="margin:0 0 10px;font-family:{SERIF};font-size:25px;line-height:1.2;color:{INK};">'
            f'<a href="{SITE_URL}/hub.html?project={urllib.parse.quote(str(tool["id"]))}" style="color:{INK};text-decoration:none;">{e(tool["title"])}</a></p>',
            f'<p style="{P}margin-bottom:20px;">{e(short(tool.get("description"), 200))}</p>',
            f'<p style="margin:0;"><a href="{SITE_URL}/hub.html" style="display:inline-block;padding:12px 26px;background:{GREEN};'
            f'font-family:{SANS};font-size:13px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;">OPEN ALL TOOLS</a></p>',
            "</td></tr></table>",
        ]

    ask_text, ask_href, ask_link = weekly_ask(end)
    out += [RULE, f'<p style="{LABEL}">From the Collective</p>']
    for line in d["published_lines"]:
        out.append(f'<p style="{P}">{e(line)}</p>')
    out.append(MARK_COLLECTIVE)
    if not d["published_lines"]:
        out.append(f'<p style="{P}">See what members are building in the '
                   f'<a href="{SITE_URL}/hub.html" style="{LINK}">Tools page</a>.</p>')

    out += [
        RULE,
        f'<p style="{LABEL}text-align:center;">One ask</p>',
        f'<div style="text-align:center;">{MARK_ASK_OPEN}<p style="{P}">{e(ask_text)} '
        f'<a href="{e(ask_href)}" style="{LINK}">{e(ask_link)}</a></p>{MARK_ASK_CLOSE}</div>',

        # sign-off and small print
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:34px;"><tr>'
        f'<td style="border-top:1px solid {INK};border-bottom:3px double {INK};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr></table>',
        f'<p style="margin:22px 0 10px;text-align:center;font-family:{SERIF};font-size:15px;font-style:italic;color:{INK};">'
        "Building intelligent healthcare together.</p>",
        f'<p style="margin:0 0 8px;text-align:center;font-family:{SANS};font-size:12px;line-height:1.6;color:{MUTED};">'
        f'Every briefing: <a href="{SITE_URL}/blog.html" style="color:{GREEN};">aimedicinecollective.com/blog</a>. '
        "Summaries are AI-drafted and reviewed by the Collective before publishing; always check the original source.</p>",
        f'<p style="margin:0;text-align:center;font-family:{SANS};font-size:12px;line-height:1.6;color:{MUTED};">'
        f'On Instagram: <a href="https://www.instagram.com/aimedicinecollective/" style="color:{GREEN};">@aimedicinecollective</a>, three briefings a week. '
        'You get this as a member. Reply to this email to reach us. To stop it, untick "Email me the weekly digest" '
        f'under Your profile on your <a href="{SITE_URL}/account.html#profile" style="color:{GREEN};">account page</a>.</p>',
        "</td></tr></table></div>",
        "</body></html>",
    ]
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- plain text

def render_text(d: dict) -> str:
    start, end = d["start"], d["end"]
    lines = [
        ":: AI MEDICINE COLLECTIVE ::",
        f"Weekly digest, {start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}",
        "",
        TEXT_NOTE,
    ]
    item = d["one_thing"]
    if item:
        lines += ["// THE ONE THING", item["title"], item["why_it_matters"], item["url"], ""]
    lines.append("// AI VS PHYSICIAN")
    for versus in d["versus"]:
        lines += [f"This week: {VERDICTS.get(versus.get('verdict'), 'Result')}", versus["title"],
                  versus["why_it_matters"], versus["url"]]
    if not d["versus"]:
        lines.append(f"No head-to-head study made the cut this week. Every study so far: {SITE_URL}/ai-vs-physician.html")
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
    ask_text, ask_href, _ = weekly_ask(end)
    lines += ["// ONE ASK", f"{TEXT_ASK_OPEN}{ask_text} {ask_href}{TEXT_ASK_CLOSE}", ""]
    lines += [
        f"Every briefing: {SITE_URL}/blog.html",
        "Summaries are AI-drafted and reviewed by the Collective before publishing; always check the original source.",
        "",
        "On Instagram: @aimedicinecollective (https://www.instagram.com/aimedicinecollective/)",
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
    # The same issue built around each item as the lead story, for the
    # Moderation page's "Lead story" choice
    options = []
    for candidate in digest["items"]:
        variant = build(end, args.days, lead_url=candidate.get("url"), tools=digest["tools"])
        options.append({
            "url": candidate.get("url"),
            "label": f"{candidate['title']} ({candidate.get('source', '')})",
            "html": render_html(variant),
            "plain": render_text(variant),
        })
    stem.with_name(f"{end.isoformat()}.leads.json").write_text(json.dumps({
        "default": (digest["one_thing"] or {}).get("url"),
        "options": options,
    }, ensure_ascii=False) + "\n", encoding="utf-8")

    # The Moderation page reads this to offer the newest issue
    (OUT_DIR / "latest.json").write_text(json.dumps({"date": end.isoformat()}) + chr(10), encoding="utf-8")
    print(f"Wrote {stem.name}.html, .txt and .json from {len(digest['week'])} post(s). Subject: {digest['subject']}")

    # (There is no weekly Instagram recap: the owner stopped it on 2026-10-26.
    # instagram.build_digest is kept in case it comes back.)
    set_output("created", "true")
    set_output("post_count", str(len(digest["week"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

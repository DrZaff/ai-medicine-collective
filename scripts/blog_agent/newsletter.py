"""Assemble the weekly digest: the past week's published blog posts, plus
projects newly published in the hub.

Writes newsletter/YYYY-MM-DD.html (email-ready, inline styles) and
newsletter/YYYY-MM-DD.txt (plain-text version). No AI call: it only
reformats posts that were already reviewed and merged, and lists projects a
moderator already published (read from the site's public API, the same
request the home page makes; if that fails the section is left out). The weekly workflow
(.github/workflows/weekly-newsletter.yml) opens a pull request with the result.

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
SITE_URL = "https://ai-medicine-collective.netlify.app"

# Public by design (see CLAUDE.md): the same address and publishable key the
# site's own pages use. They can only read what signed-out visitors can.
API_URL = "https://ahwnarhmuzxgjindreuz.supabase.co/rest/v1"
API_KEY = "sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT"

# Terminal palette from CLAUDE.md, inlined because email clients drop <style>
SECTION_LABELS = {"med_ed": "Med-ed review", "ai_vs_human": "AI vs human"}
BG, PANEL, TEXT, ACCENT, DIM = "#000000", "#020802", "#00ff66", "#00cc55", "#7fd9a3"
FONT = "'Courier New', Courier, monospace"


def today_eastern() -> dt.date:
    """Today's date in US Eastern time (falls back to the machine's local date
    where no time zone database is installed, e.g. some Windows setups)."""
    try:
        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except ZoneInfoNotFoundError:
        return dt.date.today()


def week_posts(end: dt.date, days: int) -> list[dict]:
    posts = []
    for path in sorted(POSTS_DIR.glob("*.json")):
        try:
            post_date = dt.date.fromisoformat(path.stem)
        except ValueError:
            continue
        if end - dt.timedelta(days=days) < post_date <= end:
            posts.append(json.loads(path.read_text(encoding="utf-8")))
    return posts


def new_projects(end: dt.date, days: int) -> list[dict]:
    """Projects published in the hub during the window. Empty on any failure."""
    since = (end - dt.timedelta(days=days - 1)).isoformat()
    query = urllib.parse.urlencode({
        "select": "id,title,category,description,created_at",
        "kind": "eq.project",
        "status": "eq.published",
        "created_at": f"gte.{since}",
        "order": "created_at.desc",
        "limit": "20",
    })
    request = urllib.request.Request(f"{API_URL}/projects?{query}", headers={"apikey": API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            rows = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        print(f"Could not read new projects ({err}); leaving that section out.")
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("title")]


def short(text: str, limit: int = 160) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def render_html(posts: list[dict], end: dt.date, days: int, projects: list[dict]) -> str:
    start = end - dt.timedelta(days=days - 1)
    e = html.escape
    title = f"AI Medicine Collective weekly digest, week ending {end.isoformat()}"
    parts = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f"<title>{e(title)}</title></head>",
        f'<body style="margin:0;background:{BG};">',
        f'<div style="background:{BG};padding:24px 12px;">',
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:640px;margin:0 auto;background:{PANEL};border:2px solid {ACCENT};'
        f'font-family:{FONT};color:{TEXT};">',
        '<tr><td style="padding:24px 20px;">',
        f'<p style="margin:0;text-align:center;font-size:20px;letter-spacing:2px;">'
        f':: AI MEDICINE COLLECTIVE ::</p>',
        f'<p style="margin:6px 0 18px;text-align:center;font-size:13px;color:{DIM};">'
        f'Weekly digest &middot; {e(start.strftime("%b %d"))} &ndash; {e(end.strftime("%b %d, %Y"))}</p>',
        f'<hr style="border:0;border-top:2px dashed {ACCENT};margin:0 0 18px;">',
    ]
    for post in posts:
        post_url = f"{SITE_URL}/blog.html?date={post['date']}"
        parts.append(
            f'<p style="margin:18px 0 4px;font-size:16px;font-weight:bold;">'
            f'&gt; <a href="{e(post_url)}" style="color:{TEXT};text-decoration:none;">'
            f'{e(post["headline"])}</a></p>'
            f'<p style="margin:0 0 10px;font-size:12px;color:{DIM};">// {e(post["date"])}</p>'
        )
        for item in post["items"]:
            label = SECTION_LABELS.get(item.get("section"))
            if label:
                parts.append(
                    f'<p style="margin:10px 0 2px;font-size:11px;letter-spacing:2px;color:{DIM};">'
                    f'{e(label.upper())}</p>')
            parts.append(
                f'<p style="margin:0 0 4px;font-size:14px;">'
                f'<a href="{e(item["url"])}" style="color:#00e5ff;">{e(item["title"])}</a> '
                f'<span style="color:{DIM};">&mdash; {e(item["source"])}</span></p>'
                f'<p style="margin:0 0 12px;font-size:13px;line-height:1.5;">{e(item["summary"])}</p>'
            )
    if projects:
        parts.append(
            f'<hr style="border:0;border-top:2px dashed {ACCENT};margin:18px 0 12px;">'
            f'<p style="margin:0 0 10px;font-size:13px;letter-spacing:2px;color:{DIM};">// NEW IN THE HUB</p>'
        )
        for project in projects:
            url = f"{SITE_URL}/hub.html?project={urllib.parse.quote(str(project['id']))}"
            parts.append(
                f'<p style="margin:0 0 2px;font-size:14px;font-weight:bold;">'
                f'&gt; <a href="{e(url)}" style="color:{TEXT};text-decoration:none;">{e(project["title"])}</a> '
                f'<span style="color:{DIM};font-weight:normal;">&mdash; {e(project.get("category") or "")}</span></p>'
                f'<p style="margin:0 0 12px;font-size:13px;line-height:1.5;">{e(short(project.get("description")))}</p>'
            )
    parts.append(
        f'<hr style="border:0;border-top:2px dashed {ACCENT};margin:18px 0 12px;">'
        f'<p style="margin:0 0 6px;font-size:13px;letter-spacing:2px;color:{DIM};">// THIS WEEK ON THE SITE</p>'
        f'<p style="margin:0 0 12px;font-size:13px;line-height:1.6;">'
        f'&gt; <a href="{SITE_URL}/tools.html" style="color:{TEXT};">Open the tools</a> on your phone and add them to your home screen.<br>'
        f'&gt; Wish a tool existed? <a href="{SITE_URL}/requests.html" style="color:{TEXT};">Post it or vote</a> (members).<br>'
        f'&gt; Not a member yet? <a href="{SITE_URL}/join.html" style="color:{TEXT};">Request membership</a>.</p>'
    )
    parts += [
        f'<hr style="border:0;border-top:2px dashed {ACCENT};margin:18px 0 12px;">',
        f'<p style="margin:0;font-size:12px;color:{DIM};">'
        f'Read every briefing at <a href="{SITE_URL}/blog.html" style="color:{TEXT};">'
        f'{SITE_URL.replace("https://", "")}/blog</a>. '
        f'Summaries are AI-drafted and reviewed by the Collective before publishing; '
        f'always check the original source.</p>',
        f'<p style="margin:10px 0 0;font-size:12px;color:{DIM};">'
        f'Members receive this digest by email. To stop it, untick "Email me the weekly digest" '
        f'under Your profile on your <a href="{SITE_URL}/account.html#profile" style="color:{TEXT};">account page</a>.</p>',
        '</td></tr></table></div>',
        '</body></html>',
    ]
    return "\n".join(parts) + "\n"


def render_text(posts: list[dict], end: dt.date, days: int, projects: list[dict]) -> str:
    start = end - dt.timedelta(days=days - 1)
    lines = [
        ":: AI MEDICINE COLLECTIVE ::",
        f"Weekly digest, {start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}",
        "",
    ]
    for post in posts:
        lines += [f"> {post['headline']} ({post['date']})", ""]
        for item in post["items"]:
            label = SECTION_LABELS.get(item.get("section"))
            lines += [f"* {(label + ': ') if label else ''}{item['title']} ({item['source']})",
                      f"  {item['url']}", f"  {item['summary']}", ""]
    if projects:
        lines += ["// NEW IN THE HUB", ""]
        for project in projects:
            lines += [f"> {project['title']} ({project.get('category') or ''})",
                      f"  {SITE_URL}/hub.html?project={project['id']}",
                      f"  {short(project.get('description'))}", ""]
    lines += [
        "// THIS WEEK ON THE SITE",
        f"> Open the tools on your phone: {SITE_URL}/tools.html",
        f"> Wish a tool existed? Post it or vote (members): {SITE_URL}/requests.html",
        f"> Not a member yet? {SITE_URL}/join.html",
        "",
        f"All briefings: {SITE_URL}/blog.html",
        "Summaries are AI-drafted and reviewed by the Collective before publishing; "
        "always check the original source.",
        "",
        "Members receive this digest by email. To stop it, untick \"Email me the weekly digest\" "
        f"under Your profile on your account page: {SITE_URL}/account.html#profile",
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
    posts = week_posts(end, args.days)
    projects = new_projects(end, args.days)
    if not posts and not projects:
        print("No published posts or new projects this week; no newsletter.")
        set_output("created", "false")
        return 0

    OUT_DIR.mkdir(exist_ok=True)
    stem = OUT_DIR / end.isoformat()
    stem.with_suffix(".html").write_text(render_html(posts, end, args.days, projects), encoding="utf-8")
    stem.with_suffix(".txt").write_text(render_text(posts, end, args.days, projects), encoding="utf-8")
    print(f"Wrote {stem.name}.html and .txt from {len(posts)} post(s) and {len(projects)} new project(s).")
    set_output("created", "true")
    set_output("post_count", str(len(posts)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

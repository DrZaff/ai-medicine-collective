"""Email members who asked for it when a new blog post is published.

Run by .github/workflows/blog-alert.yml after a push to main ADDS
blog/posts/YYYY-MM-DD.json. Makes no AI call. It builds a short email from the
post file (subject: the post's headline; for each review, its one-line teaser
and title; one button to the post on the site; how to switch alerts off; the
independence note), waits until the post is live on the site, then hands the
email to the database:

    queue_blog_alert(p_secret, p_date, p_subject, p_html, p_text)   (migration 026)

through Supabase's REST API with the public publishable key. The database
checks the shared secret, refuses a second alert for the same post, and queues
one copy for each approved member who switched "Email me new blog posts" on;
copies go out within Resend's daily allowance (shared with the digest). This
script never sees an email address.

Needs one GitHub Actions secret, BLOG_ALERT_SECRET (the same random value is
stored in Supabase Vault as blog_alert_secret). Without it this prints a
notice and exits quietly.

Usage:
    python scripts/blog_agent/blog_alert.py --date 2026-11-13 --dry-run
        print the email (subject, plain text) and write the HTML next to the
        path given by --html-out, if any; sends nothing
    python scripts/blog_agent/blog_alert.py --date 2026-11-13 --wait-live 600
        wait up to 600 seconds for the post to be live, then queue the alert
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from newsletter import (  # noqa: E402  (same folder; shares the digest's look)
    API_KEY, DESK, GREEN, INK, MUTED, PAPER, RULE_COLOR, SANS, SERIF, SITE_URL, TINT,
)

ROOT = Path(__file__).resolve().parents[2]
POSTS_DIR = ROOT / "blog" / "posts"
RPC_URL = "https://ahwnarhmuzxgjindreuz.supabase.co/rest/v1/rpc/queue_blog_alert"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TEASER_MAX = 110
INDEPENDENCE = ("The AI Medicine Collective is an independent, volunteer-run group. "
                "Our briefings are for educational purposes only and are not medical advice; "
                "check every claim against the original source and your own clinical judgment.")
SECTION_LABELS = {"med_ed": "Medical education", "ai_vs_human": "AI vs physician"}
# Words a line should not end on once it has been shortened
DANGLING = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or",
            "the", "to", "with", "which", "that", "than", "but", "its", "their", "is", "are", "was"}


def clean(text: object) -> str:
    return " ".join(str(text or "").split())


def shorten(text: str, limit: int) -> str:
    """Fit text in `limit` characters without cutting a word or adding "…":
    the whole text if it fits, else up to a clause break, else up to a word
    break with no dangling little word at the end."""
    text = clean(text)
    if len(text) <= limit:
        return text
    window = text[:limit + 1]
    for mark in ("; ", ": ", " — ", ", "):
        cut = window.rfind(mark)
        if cut >= limit * 0.45:
            return text[:cut].rstrip(" ,;:—")
    words = window[:window.rfind(" ")].split()
    while len(words) > 3 and words[-1].lower().strip(",;:") in DANGLING:
        words.pop()
    return " ".join(words).rstrip(" ,;:—")


def first_sentence(text: str) -> str:
    """The first sentence, without splitting on "e.g.", "vs." or decimals."""
    text = clean(text)
    match = re.search(r"(?<!\be\.g)(?<!\bi\.e)(?<!\bvs)(?<!\bet al)[.!?](?=\s+[A-Z\"'(])", text)
    return text[:match.end()] if match else text


def teaser(item: dict) -> str:
    """The review's one-line hook: its own teaser if the draft has one (newer
    posts), else the first sentence of "Why it matters", shortened sensibly."""
    own = clean(item.get("teaser"))
    if own:
        return shorten(own, TEASER_MAX + 30)
    line = first_sentence(item.get("why_it_matters", ""))
    if len(line) <= 160:
        return line
    return shorten(line, 150) + "."


def subject_for(post: dict) -> str:
    """The post's headline if it fits an inbox, else its first clause, never
    cut off with "…" (the digest's rule, CLAUDE.md)."""
    headline = clean(post.get("headline"))
    if headline and len(headline) <= 90:
        return headline
    for cut in (";", ", and ", ": ", " and "):
        first = headline.split(cut)[0].strip().rstrip(",")
        if 25 <= len(first) <= 90:
            return first
    return "New on the AI Medicine Collective blog"


def post_url(date: str) -> str:
    return f"{SITE_URL}/blog.html?date={date}"


def build(post: dict, date: str) -> dict:
    e = html.escape
    subject = subject_for(post)
    link = post_url(date)
    settings = f"{SITE_URL}/account.html#blog-alerts"
    items = [i for i in post.get("items", []) if clean(i.get("title"))]

    out = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<meta name="color-scheme" content="light">',
        f"<title>{e(subject)}</title></head>",
        f'<body style="margin:0;background:{DESK};">',
        f'<div style="display:none;max-height:0;overflow:hidden;">{e(teaser(items[0]) if items else "")}</div>',
        f'<div style="background:{DESK};padding:28px 12px;">',
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:580px;margin:0 auto;background:{PAPER};border:1px solid {RULE_COLOR};">',
        '<tr><td style="padding:34px 38px 30px;">',
        f'<p style="margin:0;font-family:{SANS};font-size:11px;font-weight:bold;letter-spacing:3px;color:{MUTED};">'
        "AI MEDICINE COLLECTIVE &nbsp;&bull;&nbsp; NEW ON THE BLOG</p>",
        f'<p style="margin:12px 0 22px;font-family:{SERIF};font-size:27px;line-height:1.2;color:{INK};">{e(clean(post.get("headline")) or subject)}</p>',
    ]
    for item in items:
        label = SECTION_LABELS.get(item.get("section"), "")
        out.append(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;background:{TINT};">'
                   '<tr><td style="padding:16px 20px;">')
        if label:
            out.append(f'<p style="margin:0 0 8px;font-family:{SANS};font-size:11px;font-weight:bold;letter-spacing:2px;'
                       f'color:{GREEN};text-transform:uppercase;">{e(label)}</p>')
        out.append(f'<p style="margin:0 0 8px;font-family:{SERIF};font-size:18px;line-height:1.45;color:{INK};">{e(teaser(item))}</p>')
        out.append(f'<p style="margin:0;font-family:{SANS};font-size:13px;line-height:1.5;color:{MUTED};">'
                   f'{e(clean(item["title"]))}{(" &mdash; " + e(clean(item.get("source")))) if clean(item.get("source")) else ""}</p>')
        out.append("</td></tr></table>")
    out += [
        f'<p style="margin:24px 0 28px;"><a href="{e(link)}" style="display:inline-block;background:{GREEN};color:#ffffff;'
        f'text-decoration:none;font-family:{SANS};font-size:15px;font-weight:bold;padding:12px 22px;border-radius:6px;">'
        "Read the post &rarr;</a></p>",
        f'<p style="margin:0;padding-top:14px;border-top:1px solid {RULE_COLOR};font-family:{SANS};font-size:12px;line-height:1.55;color:{MUTED};">'
        "You get this because you asked for new blog posts by email. "
        f'<a href="{e(settings)}" style="color:{MUTED};text-decoration:underline;">Switch blog alerts off</a> '
        "on your account page (untick &ldquo;Email me new blog posts&rdquo; and save).</p>",
        f'<p style="margin:10px 0 0;font-family:{SANS};font-size:12px;line-height:1.55;color:{MUTED};">{e(INDEPENDENCE)}</p>',
        "</td></tr></table></div></body></html>",
    ]

    text = [clean(post.get("headline")) or subject, "New on the AI Medicine Collective blog", ""]
    for item in items:
        label = SECTION_LABELS.get(item.get("section"), "")
        text += [f"{label.upper()}: {teaser(item)}" if label else teaser(item),
                 f"  {clean(item['title'])}" + (f" ({clean(item.get('source'))})" if clean(item.get("source")) else ""), ""]
    text += [f"Read the post: {link}", "", "--",
             "You get this because you asked for new blog posts by email.",
             f"To stop: {settings} (untick \"Email me new blog posts\" and save).",
             INDEPENDENCE]
    return {"subject": subject, "html": "\n".join(out), "text": "\n".join(text)}


def wait_until_live(date: str, seconds: int) -> bool:
    url = f"{SITE_URL}/blog/posts/{date}.json"
    deadline = time.monotonic() + seconds
    while True:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "amc-blog-alert/1.0", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=20) as response:
                if response.status == 200 and json.loads(response.read().decode("utf-8")).get("items"):
                    print(f"The post is live: {url}")
                    return True
        except (urllib.error.URLError, TimeoutError, ValueError):
            pass
        if time.monotonic() >= deadline:
            return False
        time.sleep(20)


def queue(date: str, email: dict, secret: str) -> int:
    payload = {"p_secret": secret, "p_date": date, "p_subject": email["subject"],
               "p_html": email["html"], "p_text": email["text"]}
    request = urllib.request.Request(
        RPC_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"apikey": API_KEY, "Authorization": f"Bearer {API_KEY}",
                 "Content-Type": "application/json", "User-Agent": "amc-blog-alert/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            count = json.loads(response.read().decode("utf-8") or "0")
            print(f"Blog alert queued for {count} member(s); they go out within the daily email allowance.")
            return 0
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")
        try:
            info = json.loads(detail)
        except ValueError:
            info = {}
        if info.get("code") == "23505":
            print(f"::notice::The alert for {date} was already sent; nothing to do.")
            return 0
        if info.get("code") == "42501":
            print("::error::The database refused the secret. BLOG_ALERT_SECRET in GitHub must match "
                  "blog_alert_secret in Supabase Vault (and migration 026 must have been run).")
            return 1
        if info.get("code") in ("PGRST202", "42883"):
            print("::warning::queue_blog_alert does not exist yet (migration 026 not run); no alert sent.")
            return 0
        print(f"::error::Alert not queued: HTTP {err.code} {detail[:300]}")
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"::error::Alert not queued: {err}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", required=True, help="the post's date, YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="print the email; send nothing")
    parser.add_argument("--html-out", type=Path, help="with --dry-run: also write the HTML here")
    parser.add_argument("--wait-live", type=int, default=0, help="seconds to wait for the post to be live")
    args = parser.parse_args()

    if not DATE_RE.match(args.date):
        print(f"::error::Not a post date: {args.date}")
        return 1
    path = POSTS_DIR / f"{args.date}.json"
    if not path.exists():
        print(f"::error::No post file {path.relative_to(ROOT)}")
        return 1
    post = json.loads(path.read_text(encoding="utf-8"))
    if not post.get("items"):
        print("::notice::The post has no reviews; no alert.")
        return 0
    email = build(post, args.date)

    if args.dry_run:
        print(f"SUBJECT: {email['subject']}\n")
        print(email["text"])
        if args.html_out:
            args.html_out.write_text(email["html"], encoding="utf-8")
            print(f"\n(HTML written to {args.html_out})")
        return 0

    secret = os.environ.get("BLOG_ALERT_SECRET", "").strip()
    if not secret:
        print("::notice::BLOG_ALERT_SECRET is not set; no blog alert sent.")
        return 0
    if args.wait_live and not wait_until_live(args.date, args.wait_live):
        print(f"::error::The post for {args.date} was not live on the site after {args.wait_live} seconds; no alert sent. "
              "Re-run this workflow by hand once the site has deployed.")
        return 1
    return queue(args.date, email, secret)


if __name__ == "__main__":
    sys.exit(main())

"""Daily blog agent for the AI Medicine Collective.

Asks Claude (with web search) for the last ~48 hours of AI-in-medical-education
news and research, keeps only items whose links came from the actual search
results, and writes blog/posts/YYYY-MM-DD.json. The GitHub workflow
(.github/workflows/daily-blog.yml) then opens a pull request; merging it is the
human review step that publishes the post.

Usage:
    python scripts/blog_agent/agent.py [--date YYYY-MM-DD] [--pr-body PATH]
    python scripts/blog_agent/agent.py --fixture sample.json   # no API call

Needs ANTHROPIC_API_KEY in the environment (a GitHub Actions secret in CI).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[2]
POSTS_DIR = ROOT / "blog" / "posts"

MODEL = "claude-opus-5-5"
EFFORT = "medium"
LOOKBACK_HOURS = 48
RECENT_DAYS_TO_AVOID = 14
MAX_PAUSE_RESUMES = 5

# Approximate list prices, used only for the cost line in the PR description.
# Check current pricing at https://www.anthropic.com/pricing before relying on it.
PRICE_INPUT_PER_MTOK = 4.00
PRICE_OUTPUT_PER_MTOK = 20.00
PRICE_CACHE_READ_PER_MTOK = 0.20
PRICE_PER_WEB_SEARCH = 0.01

CATEGORIES = ["education", "research", "news", "policy", "tool"]

SYSTEM_PROMPT = """\
You are the editor of the AI Medicine Collective's daily briefing, read by \
medical students, residents, and faculty who want to keep up with AI in \
medicine without wading through hype.

Each day you find and summarize the most useful recent items about AI in \
medical education, plus a small number of notable AI-in-medicine research, \
policy, or tool updates that matter to trainees and educators.

Editorial rules:
- Use web search to find items published within the lookback window you are \
given. Prefer primary sources: journal articles, preprints from reputable \
servers, official announcements from medical schools, societies, regulators, \
and companies. Prefer reputable outlets over aggregators and press-release \
mirrors.
- Every item must link to a URL you actually found with your search tools in \
this conversation. Never construct, guess, or shorten a URL. If you cannot \
confirm an item's source, leave it out.
- Report what the source says. Do not invent numbers, quotes, study sizes, or \
conclusions. Say plainly when something is a preprint, a press release, or \
an opinion piece.
- Never include patient-identifiable information of any kind.
- Skip items already covered recently (you are given that list).
- Quality over quantity: 3 to 6 items is ideal. If fewer qualify, return \
fewer. If nothing qualifies, return an empty items list.
- Write in clear, plain language for busy clinicians. Each summary is 2 to 3 \
sentences; "why it matters" is 1 to 2 sentences aimed at learners and \
educators.
- The headline is a short, specific title for the whole day's briefing (no \
clickbait). The intro is 1 to 2 sentences tying the day's items together.
"""

POST_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "intro": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "source": {"type": "string", "description": "Publisher or journal name"},
                    "url": {"type": "string"},
                    "published": {"type": "string", "description": "YYYY-MM-DD"},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "summary": {"type": "string"},
                    "why_it_matters": {"type": "string"},
                },
                "required": [
                    "title", "source", "url", "published",
                    "category", "summary", "why_it_matters",
                ],
                "additionalProperties": False,
            },
        },
        "tags": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "intro", "items", "tags"],
    "additionalProperties": False,
}

TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 12},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 8},
]


# ---------------------------------------------------------------- helpers

def today_eastern() -> dt.date:
    """Today's date in US Eastern time (falls back to the machine's local date
    where no time zone database is installed, e.g. some Windows setups)."""
    try:
        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except ZoneInfoNotFoundError:
        return dt.date.today()


def normalize_url(url: str) -> str:
    """Compare URLs loosely: lowercase host, no fragment, no tracking params,
    no trailing slash."""
    parts = urlsplit(url.strip())
    query = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(("utm_", "fbclid", "gclid", "mc_"))
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def recent_posts(before: dt.date, days: int) -> list[dict]:
    posts = []
    for path in sorted(POSTS_DIR.glob("*.json"), reverse=True):
        try:
            post_date = dt.date.fromisoformat(path.stem)
        except ValueError:
            continue
        if before - dt.timedelta(days=days) <= post_date < before:
            posts.append(json.loads(path.read_text(encoding="utf-8")))
    return posts


def collect_urls(value, found: set[str]) -> None:
    """Gather every 'url' string inside search/fetch result blocks."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if key == "url" and isinstance(inner, str) and inner.startswith("http"):
                found.add(normalize_url(inner))
            else:
                collect_urls(inner, found)
    elif isinstance(value, list):
        for inner in value:
            collect_urls(inner, found)


def build_user_prompt(date: dt.date, avoid: list[dict]) -> str:
    window_start = date - dt.timedelta(hours=LOOKBACK_HOURS)
    covered = [
        f"- {item['title']} ({item['url']})"
        for post in avoid for item in post.get("items", [])
    ]
    covered_text = "\n".join(covered) if covered else "(none)"
    return (
        f"Today is {date.isoformat()}. Prepare today's briefing.\n\n"
        f"Lookback window: items published from {window_start.isoformat()} "
        f"through {date.isoformat()}.\n\n"
        f"Already covered in the last {RECENT_DAYS_TO_AVOID} days (do not repeat):\n"
        f"{covered_text}\n\n"
        "Search broadly (for example: AI in medical education, AI tutors or "
        "simulation for medical students and residents, LLMs in clinical "
        "training, AI assessment and feedback in GME, plus major AI-in-medicine "
        "studies, guidelines, or regulatory news), then return the briefing in "
        "the required JSON format."
    )


# ---------------------------------------------------------------- Claude call

def run_claude(date: dt.date, avoid: list[dict]) -> tuple[dict, set[str], dict]:
    import anthropic  # imported here so --fixture runs without the SDK

    client = anthropic.Anthropic()
    user_turn = {"role": "user", "content": build_user_prompt(date, avoid)}
    messages = [user_turn]
    assistant_so_far: list = []  # content from paused turns, resent so work isn't lost
    found_urls: set[str] = set()
    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "searches": 0}

    for _ in range(MAX_PAUSE_RESUMES + 1):
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=32000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            output_config={
                "effort": EFFORT,
                "format": {"type": "json_schema", "schema": POST_SCHEMA},
            },
            messages=messages,
        ) as stream:
            response = stream.get_final_message()

        u = response.usage
        usage["input"] += u.input_tokens or 0
        usage["output"] += u.output_tokens or 0
        usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
        usage["cache_write"] += getattr(u, "cache_creation_input_tokens", 0) or 0
        server_tools = getattr(u, "server_tool_use", None)
        if server_tools is not None:
            usage["searches"] += getattr(server_tools, "web_search_requests", 0) or 0

        for block in response.content:
            if block.type.endswith("_tool_result"):
                collect_urls(block.to_dict(), found_urls)

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            raise SystemExit(f"Claude declined the request: {details}")

        if response.stop_reason == "pause_turn":
            # Server-side tool loop paused; resend the turn so far (no extra
            # "continue" message) and the server resumes where it stopped.
            assistant_so_far += list(response.content)
            messages = [user_turn, {"role": "assistant", "content": assistant_so_far}]
            continue

        if response.stop_reason == "max_tokens":
            raise SystemExit("Response hit max_tokens before finishing the JSON.")

        texts = [b.text for b in response.content if b.type == "text" and b.text.strip()]
        if not texts:
            raise SystemExit(f"No JSON text in the response (stop_reason={response.stop_reason}).")
        return json.loads(texts[-1]), found_urls, usage

    raise SystemExit(f"Still paused after {MAX_PAUSE_RESUMES} resumes; giving up.")


def estimate_cost(usage: dict) -> float:
    return (
        usage["input"] / 1e6 * PRICE_INPUT_PER_MTOK
        + usage["cache_write"] / 1e6 * PRICE_INPUT_PER_MTOK * 1.25
        + usage["cache_read"] / 1e6 * PRICE_CACHE_READ_PER_MTOK
        + usage["output"] / 1e6 * PRICE_OUTPUT_PER_MTOK
        + usage["searches"] * PRICE_PER_WEB_SEARCH
    )


# ---------------------------------------------------------------- validation

def verify_items(result: dict, found_urls: set[str], avoid: list[dict]) -> tuple[list[dict], list[str]]:
    """Keep items whose URL appeared in the search results and wasn't covered
    recently. Returns (kept, reasons for dropped items)."""
    covered = {normalize_url(i["url"]) for p in avoid for i in p.get("items", [])}
    kept, dropped, seen = [], [], set()

    for item in result.get("items", []):
        url = item.get("url", "")
        key = normalize_url(url) if url.startswith(("http://", "https://")) else ""
        if not key:
            dropped.append(f"{item.get('title', '?')}: not a web link")
        elif key not in found_urls:
            dropped.append(f"{item.get('title', '?')}: link not found in search results ({url})")
        elif key in covered or key in seen:
            dropped.append(f"{item.get('title', '?')}: already covered")
        else:
            seen.add(key)
            kept.append(item)
    return kept, dropped


# ---------------------------------------------------------------- output

def write_pr_body(path: Path, post: dict, dropped: list[str], usage: dict | None) -> None:
    lines = [
        f"## {post['headline']}",
        "",
        post["intro"],
        "",
        "### Items",
    ]
    for n, item in enumerate(post["items"], 1):
        lines += [
            f"{n}. **{item['title']}** — {item['source']}, {item['published']} "
            f"(`{item['category']}`)",
            f"   - {item['url']}",
            f"   - {item['summary']}",
            f"   - *Why it matters:* {item['why_it_matters']}",
        ]
    if dropped:
        lines += ["", "### Removed automatically", *[f"- {d}" for d in dropped]]
    lines += [
        "",
        "### Before merging (merging publishes the post)",
        "- [ ] Open each link: it works and says what the summary says",
        "- [ ] No patient information anywhere",
        "- [ ] Nothing misleading, overstated, or off-topic",
        "",
        "To skip today's post, close this PR without merging.",
    ]
    if usage is not None:
        lines += [
            "",
            f"<sub>Drafted by `{MODEL}` (effort `{EFFORT}`): "
            f"{usage['input'] + usage['cache_read'] + usage['cache_write']:,} input tokens, "
            f"{usage['output']:,} output tokens, {usage['searches']} web searches, "
            f"about ${estimate_cost(usage):.2f}.</sub>",
        ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def set_output(name: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")
    print(f"{name}={value}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Defaults to today (US Eastern)")
    parser.add_argument("--pr-body", type=Path, help="Where to write the PR description")
    parser.add_argument("--fixture", type=Path,
                        help='Test without the API: JSON {"result": {...}, "search_urls": [...]}')
    args = parser.parse_args()

    date: dt.date = args.date or today_eastern()
    post_path = POSTS_DIR / f"{date.isoformat()}.json"
    set_output("date", date.isoformat())

    if post_path.exists():
        print(f"{post_path.relative_to(ROOT)} already exists; nothing to do.")
        set_output("post_created", "false")
        return 0

    avoid = recent_posts(date, RECENT_DAYS_TO_AVOID)

    if args.fixture:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
        result = fixture["result"]
        found_urls = {normalize_url(u) for u in fixture.get("search_urls", [])}
        usage = None
    else:
        result, found_urls, usage = run_claude(date, avoid)
        print(f"Usage: {usage} (about ${estimate_cost(usage):.2f})")

    items, dropped = verify_items(result, found_urls, avoid)
    for reason in dropped:
        print(f"Dropped: {reason}")

    if not items:
        print("No verified items today; no post written.")
        set_output("post_created", "false")
        return 0

    post = {
        "date": date.isoformat(),
        "headline": result["headline"].strip(),
        "intro": result["intro"].strip(),
        "items": items,
        "tags": sorted({t.strip().lower() for t in result.get("tags", []) if t.strip()}),
        "generated_by": MODEL,
    }
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    post_path.write_text(json.dumps(post, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {post_path.relative_to(ROOT)} with {len(items)} item(s).")

    if args.pr_body:
        write_pr_body(args.pr_body, post, dropped, usage)
    set_output("post_created", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())

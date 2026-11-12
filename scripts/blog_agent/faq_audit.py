"""Monthly FAQ audit: keep the answers current and choose what to answer next.

Runs on the 2nd of each month (.github/workflows/faq-audit.yml) and opens a
pull request "FAQ audit: <date>" with a report (faq/audits/<date>.md) and an
updated target list (faq/targets.json). Merging accepts the new targets and
refresh requests; the FAQ agent (faq_agent.py) then works through them, one
answer every other day, each by its own pull request.

Checks, without AI:
  - every source link (broken, or blocking automated checks)
  - answers not reviewed for about six months
  - studies added to the AI vs Physician register since an answer was last
    reviewed that look related to it (possible newer evidence)
  - questions that overlap
With AI (skipped without ANTHROPIC_API_KEY, or with --no-ai):
  - which flagged answers really need rewriting, queued as refresh targets
  - 6 to 10 new questions worth answering: specific, long-tail questions that
    clinicians, trainees and app builders ask search engines and AI
    assistants about AI in medicine, medical education and building medical
    apps, which the FAQ does not answer yet

Usage:
    python scripts/blog_agent/faq_audit.py [--date YYYY-MM-DD] [--pr-body PATH] [--no-ai] [--skip-links]
    python scripts/blog_agent/faq_audit.py --fixture sample.json --skip-links   # no API call
    The fixture is JSON {"result": {"refresh": [...], "new_targets": [...], "note": ""}}.
    Never commit the faq/ files a test run changes.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402
import faq_agent as fa  # noqa: E402

AUDITS_DIR = agent.ROOT / "faq" / "audits"
STALE_DAYS = 180
OVERLAP = 0.7     # question similarity worth a look (faq_agent refuses at 0.75)
TOOLS = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]

SYSTEM = """\
You audit the AI Medicine Collective's FAQ about AI in medicine, medical \
education, residency and fellowship applications, and building medical apps \
with AI. Its goal is to be the most \
useful, citable source that clinicians, trainees and search engines and AI \
assistants find for these questions.

1. "refresh": from the flagged answers you are given, list only those that \
really need rewriting (newer or stronger evidence that changes or sharpens \
the bottom line, or an outdated claim), each with a one-sentence reason \
naming the newer evidence. Leave out flags that do not matter.
2. "new_targets": 6 to 10 new questions to answer next. Choose questions \
people really ask search engines or AI assistants, specific and long-tail \
rather than broad, that good evidence or official guidance can answer, and \
that neither the FAQ nor the target list already covers. Spread them across \
the categories, favouring gaps. You may use web search to check what is \
current. Give each a priority from 1 to 5 (5 = most likely to be searched \
and most useful) and 3 to 5 search phrases.
3. "note": two or three sentences for the editors on the FAQ's coverage.
Never include patient information.
"""


def schema(categories: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "refresh": {"type": "array", "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["id", "reason"], "additionalProperties": False}},
            "new_targets": {"type": "array", "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "category": {"type": "string", "enum": categories},
                               "priority": {"type": "integer"}, "keywords": {"type": "array", "items": {"type": "string"}},
                               "why": {"type": "string"}},
                "required": ["question", "category", "priority", "keywords", "why"], "additionalProperties": False}},
            "note": {"type": "string"},
        },
        "required": ["refresh", "new_targets", "note"],
        "additionalProperties": False,
    }


# ---------------------------------------------------------------- checks without AI

def check_link(url: str) -> tuple[str, str]:
    """('ok' | 'blocked' | 'broken', detail). Many publishers and government
    sites refuse automated requests (403, 429); those are 'blocked', not broken."""
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (AI Medicine Collective link check)"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return "ok", str(response.status)
    except urllib.error.HTTPError as err:
        if err.code in (404, 410):
            return "broken", f"HTTP {err.code}"
        return "blocked", f"HTTP {err.code}"
    except Exception as err:  # timeouts, DNS, TLS
        return "blocked", type(err).__name__


def check_links(faq: dict) -> dict[str, tuple[str, str]]:
    urls = sorted({s["url"] for item in faq["items"] for s in item.get("sources", []) if s.get("url", "").startswith("http")})
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        return dict(zip(urls, pool.map(check_link, urls)))


def stale(faq: dict, date: dt.date) -> list[dict]:
    old = []
    for item in faq["items"]:
        try:
            reviewed = dt.date.fromisoformat(item.get("updated") or item.get("added"))
        except (TypeError, ValueError):
            continue
        if (date - reviewed).days >= STALE_DAYS:
            old.append(item)
    return old


def newer_evidence(faq: dict) -> dict[str, list[dict]]:
    """Register studies added after an answer was last reviewed that share at
    least two meaningful words with its question and search phrases."""
    try:
        studies = fa.load(fa.REVIEW_PATH).get("studies", [])
    except (OSError, ValueError):
        return {}
    cited = {agent.normalize_url(s["url"]) for item in faq["items"] for s in item.get("sources", [])}
    found = {}
    for item in faq["items"]:
        topic = fa.words(" ".join([item["question"], *item.get("keywords", [])]))
        hits = []
        for study in studies:
            if str(study.get("added", "")) <= str(item.get("updated", "")) or agent.normalize_url(study.get("url", "")) in cited:
                continue
            shared = topic & fa.words(study.get("title", ""))
            if len(shared) >= 2:
                hits.append((len(shared), study))
        if hits:
            found[item["id"]] = [s for _, s in sorted(hits, key=lambda h: -h[0])[:3]]
    return found


def overlaps(faq: dict) -> list[tuple[str, str, float]]:
    items = faq["items"]
    pairs = []
    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            score = fa.similarity(items[a]["question"], items[b]["question"])
            if score >= OVERLAP:
                pairs.append((items[a]["question"], items[b]["question"], score))
    return pairs


# ---------------------------------------------------------------- report

def report(date: dt.date, faq: dict, links: dict, old: list[dict], newer: dict, pairs: list, ai: dict | None,
           added: list[dict], refreshed: list[dict], usage: dict | None) -> str:
    broken = {u: d for u, (s, d) in links.items() if s == "broken"}
    blocked = {u: d for u, (s, d) in links.items() if s == "blocked"}
    by_id = {item["id"]: item for item in faq["items"]}
    lines = [
        f"# FAQ audit: {date.isoformat()}",
        "",
        f"{len(faq['items'])} answers. Links checked: {len(links)} ({len(broken)} broken, {len(blocked)} refused automated checks). "
        f"Not reviewed for {STALE_DAYS} days or more: {len(old)}. With possibly newer evidence: {len(newer)}. "
        f"Overlapping questions: {len(pairs)}.",
        "",
        "## What merging this does",
        f"- Adds {len(added)} new {'question' if len(added) == 1 else 'questions'} to `faq/targets.json`; the FAQ agent "
        "answers the highest-priority ones first, one every other day, each in its own pull request.",
        f"- Queues {len(refreshed)} {'answer' if len(refreshed) == 1 else 'answers'} to be rewritten from newer evidence, "
        "also one per pull request.",
        "- Remove or reorder any target in this pull request before merging; nothing is published by this merge.",
    ]
    if broken:
        lines += ["", "## Broken links (fix by hand)", *[f"- {u} ({d})" for u, d in broken.items()]]
    if blocked:
        lines += ["", "## Links that refused the automated check", "Usually publisher or government sites that block robots; "
                  "open one or two to be sure.", *[f"- {u} ({d})" for u, d in sorted(blocked.items())]]
    if old:
        lines += ["", "## Not reviewed recently", *[f"- {i['question']} (last reviewed {i.get('updated')})" for i in old]]
    if newer:
        lines += ["", "## Possibly newer evidence in the AI vs Physician register"]
        for item_id, studies in newer.items():
            lines.append(f"- **{by_id[item_id]['question']}**")
            lines += [f"  - [{s['title']}]({s['url']}) ({s.get('source', '')}, added {s.get('added', '')})" for s in studies]
    if pairs:
        lines += ["", "## Overlapping questions", *[f"- {a} / {b} ({score:.2f})" for a, b, score in pairs]]
    if refreshed:
        lines += ["", "## Queued for a rewrite", *[f"- {t['question']}: {t.get('note', '')}" for t in refreshed]]
    if added:
        lines += ["", "## New questions queued",
                  *[f"- (priority {t['priority']}, {t['category']}) {t['question']}: {t.get('note', '')}" for t in added]]
    if ai and ai.get("note"):
        lines += ["", "## Coverage note", ai["note"]]
    if ai is None:
        lines += ["", "_The AI step was skipped (no API key, or --no-ai), so no targets were added._"]
    if usage:
        lines += ["", f"<sub>Audited with `{agent.MODEL}`: about ${agent.estimate_cost(usage):.2f}.</sub>"]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Defaults to today (US Eastern)")
    parser.add_argument("--pr-body", type=Path, help="Where to write the PR description")
    parser.add_argument("--fixture", type=Path, help="Test without the API (see the docstring)")
    parser.add_argument("--no-ai", action="store_true", help="Run only the checks that need no AI")
    parser.add_argument("--skip-links", action="store_true", help="Do not check links (offline testing)")
    args = parser.parse_args()

    date = args.date or agent.today_eastern()
    agent.set_output("date", date.isoformat())
    faq, targets = fa.load(fa.FAQ_PATH), fa.load(fa.TARGETS_PATH)

    links = {} if args.skip_links else check_links(faq)
    old, newer, pairs = stale(faq, date), newer_evidence(faq), overlaps(faq)
    flagged = {item["id"]: [] for item in faq["items"]}
    for item in old:
        flagged[item["id"]].append(f"not reviewed since {item.get('updated')}")
    for item_id, studies in newer.items():
        flagged[item_id] += [f"newer register study: {s['title']} ({s.get('source', '')}, {s.get('published', '')})" for s in studies]
    for item in faq["items"]:
        bad = [s["url"] for s in item.get("sources", []) if links.get(s["url"], ("ok",))[0] == "broken"]
        if bad:
            flagged[item["id"]].append(f"broken source links: {', '.join(bad)}")
    flagged = {k: v for k, v in flagged.items() if v}

    ai, usage = None, None
    if args.fixture:
        ai = json.loads(args.fixture.read_text(encoding="utf-8"))["result"]
    elif not args.no_ai and os.environ.get("ANTHROPIC_API_KEY"):
        by_id = {item["id"]: item for item in faq["items"]}
        prompt = (f"Today is {date.isoformat()}.\n\nCategories: " + ", ".join(f'"{c["id"]}" ({c["name"]})' for c in faq["categories"])
                  + "\n\nThe FAQ answers:\n" + "\n".join(f'- [{i["category"]}] {i["question"]}' for i in faq["items"])
                  + "\n\nAlready on the target list:\n" + "\n".join(f'- {t["question"]}' for t in targets["targets"] if t.get("status") == "open")
                  + "\n\nFlagged answers (id: question; flags):\n"
                  + ("\n".join(f'- {k}: {by_id[k]["question"]}; ' + "; ".join(v) for k, v in flagged.items()) or "(none)"))
        ai, _, usage = agent.run_claude(prompt, system=SYSTEM, schema=schema([c["id"] for c in faq["categories"]]), tools=TOOLS)
    else:
        print("::notice::No ANTHROPIC_API_KEY (or --no-ai): only the checks without AI were run.")

    added, refreshed = [], []
    if ai:
        ids = {item["id"]: item for item in faq["items"]}
        open_refresh = {t.get("refresh_id") for t in targets["targets"] if t.get("status") == "open"}
        for entry in ai.get("refresh", []):
            if entry.get("id") in ids and entry["id"] not in open_refresh:
                target = {"question": f"Refresh: {ids[entry['id']]['question']}", "category": ids[entry["id"]]["category"],
                          "priority": 4, "keywords": ids[entry["id"]].get("keywords", []), "status": "open",
                          "refresh_id": entry["id"], "note": entry.get("reason", ""), "added": date.isoformat(), "from": "audit"}
                targets["targets"].append(target)
                refreshed.append(target)
        known = [i["question"] for i in faq["items"]] + [t["question"] for t in targets["targets"]]
        categories = {c["id"] for c in faq["categories"]}
        for entry in ai.get("new_targets", [])[:10]:
            question = entry.get("question", "").strip()
            if not question or entry.get("category") not in categories or any(fa.similarity(question, q) >= fa.SIMILAR for q in known):
                continue
            target = {"question": question, "category": entry["category"], "priority": max(1, min(5, int(entry.get("priority", 3)))),
                      "keywords": entry.get("keywords", [])[:5], "status": "open", "note": entry.get("why", ""),
                      "added": date.isoformat(), "from": "audit"}
            targets["targets"].append(target)
            added.append(target)
            known.append(question)
        fa.save(fa.TARGETS_PATH, targets)

    text = report(date, faq, links, old, newer, pairs, ai, added, refreshed, usage)
    AUDITS_DIR.mkdir(parents=True, exist_ok=True)
    (AUDITS_DIR / f"{date.isoformat()}.md").write_text(text, encoding="utf-8")
    if args.pr_body:
        args.pr_body.write_text(text, encoding="utf-8")
    print(text)
    agent.set_output("created", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())

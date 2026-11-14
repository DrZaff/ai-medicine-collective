"""FAQ agent: draft one new evidence-based answer for faq.html.

Runs every other day (.github/workflows/faq-draft.yml). It takes the
highest-priority open question in faq/targets.json (or, when the list is
empty, asks Claude to choose a useful question the FAQ does not answer yet),
has Claude search the literature and write one answer, checks it, adds it to
faq/faq.json and opens a pull request "FAQ draft: <date>". Merging the pull
request publishes the answer; closing it skips it.

A target with "refresh_id" asks for a rewrite of that existing answer from
newer evidence (the monthly audit, faq_audit.py, queues these); the answer
keeps its address and gets a new "updated" date.

Safeguards, the same as the blog agent's:
  - a source is kept only if its link appeared in this run's search or fetch
    results, or is already a checked source (the AI vs Physician register or
    an existing answer); an answer that cites a source that fails this check
    is not used at all
  - a question too close to an existing one is refused
  - the prompt forbids patient information and personal medical advice

Numbers are checked against the sources' own text (issue #185, after #181
was drafted from memory): once Claude has written the answer, this script
fetches the text of every cited paper itself (PubMed Central full text when
open access, else the PubMed abstract, through NCBI's API; see
living_review.paper_text), and a second request with no web access corrects
the answer against those texts. number_check.py then checks every number
against the text of the source its sentence cites, without AI. Any number it
cannot match (missing, rounded, wrong denominator, only in another source,
or a source whose text could not be fetched) makes the draft "NEEDS
FACT-CHECK": --fact-check-file gets the warning (the workflow puts it
first in the email and in the PR title), and the PR body opens with it. A
person always checks that matched numbers are used in the same sense.

Spending is bounded by small search and fetch limits plus one short request
with no web access (about $0.60 to $1.20 a run).

Usage:
    python scripts/blog_agent/faq_agent.py [--date YYYY-MM-DD] [--pr-body PATH] [--fact-check-file PATH]
    python scripts/blog_agent/faq_agent.py --fixture sample.json   # no API or network call
    The fixture is JSON {"result": {...the answer...}, "search_urls": [...],
    "source_texts": {"<url>": "<retrieved text, or empty for unavailable>"},
    "revised": {...optional answer as corrected against the texts...}}.
    Never commit the faq/ files a test run changes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402
import number_check  # noqa: E402

FAQ_PATH = agent.ROOT / "faq" / "faq.json"
TARGETS_PATH = agent.ROOT / "faq" / "targets.json"
REVIEW_PATH = agent.ROOT / "evidence" / "ai-vs-human.json"
SITE = "https://www.aimedicinecollective.com"

MIN_WORDS, MAX_WORDS = 70, 200
SIMILAR = 0.75  # share of question words in common at which a question counts as a duplicate

TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 8},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 4, "max_content_tokens": 6000},
]

SYSTEM = """\
You write answers for the AI Medicine Collective's FAQ about AI in medicine, \
read by clinicians, trainees and clinicians who build apps, and quoted by \
search engines and AI assistants. Each answer must be the most accurate, \
useful and citable short answer on the web to that question.

Rules:
- The first sentence answers the question directly, in plain words (it is \
what an answer engine will quote). Then 3 to 6 sentences of evidence: the \
strongest studies or official guidance, with their key numbers, and the \
main limitation. End with one practical sentence where that helps. 80 to 180 \
words in total.
- Prefer, in order: randomized trials and large prospective studies in major \
journals, systematic reviews, official guidance (FDA, HHS, WHO, AAMC, NRMP and \
similar), then other peer-reviewed studies. For application questions, say \
exactly who does what (ERAS, the AAMC, programs, vendors such as Thalamus) and \
say plainly what is not publicly documented. Say so plainly when evidence is \
from written cases, a preprint, or a single centre. Never cite news stories, \
vendor marketing or blogs.
- Cite sources with [1], [2] markers that match the order of "sources". \
Every number must appear in the source it is cited to. Never invent a \
number, a study, a quote or a link.
- Every source URL must be one you found with your tools in this \
conversation, or one from the list of already checked sources you are given. \
Never construct, guess or shorten a URL. Prefer the PubMed page \
(https://pubmed.ncbi.nlm.nih.gov/<PMID>/) for journal articles.
- Do not spend web_fetch on PubMed pages: they show automated readers no \
abstract. Use web_search to find studies; after you answer, the abstracts and \
open full texts of PubMed sources are fetched for you and every number is \
checked against them, so prefer studies with a PubMed page.
- Never include patient-identifiable information. Never give personal \
medical, legal or regulatory advice; for those topics say the answer is \
general information.
- Do not mention the AI Medicine Collective unless the question is about it.
- "question" is the question as people would type or ask it. "keywords" are \
3 to 5 phrases people search for. "note" is for the editors only: what you \
searched, and anything you could not confirm.
"""


def schema(categories: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "category": {"type": "string", "enum": categories},
            "answer": {"type": "string"},
            "sources": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "url": {"type": "string"},
                        "source": {"type": "string", "description": "Journal or organization"},
                        "published": {"type": "string", "description": "YYYY-MM-DD, YYYY-MM, YYYY or empty"},
                    },
                    "required": ["title", "url", "source", "published"],
                    "additionalProperties": False,
                },
            },
            "keywords": {"type": "array", "items": {"type": "string"}},
            "note": {"type": "string"},
        },
        "required": ["question", "category", "answer", "sources", "keywords", "note"],
        "additionalProperties": False,
    }


# ---------------------------------------------------------------- helpers

def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def words(text: str) -> set[str]:
    stop = {"a", "an", "the", "of", "to", "in", "and", "or", "is", "are", "do", "does", "can", "i", "my", "for",
            "with", "how", "what", "when", "should", "it", "be", "on", "at", "by", "ai", "will", "use", "using",
            "me", "you", "your", "than", "more", "better", "there", "from", "that", "this"}
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in stop}


def similarity(a: str, b: str) -> float:
    """Words in common over words in either (a rough guard against restating a
    question; the prompt and the reviewer catch subtler overlaps)."""
    x, y = words(a), words(b)
    return len(x & y) / max(1, len(x | y))


def slug(question: str, taken: set[str]) -> str:
    base = "-".join(re.findall(r"[a-z0-9]+", question.lower()))[:70].strip("-") or "question"
    name, n = base, 2
    while name in taken:
        name, n = f"{base}-{n}", n + 1
    return name


def checked_sources() -> dict[str, dict]:
    """Links already checked: the AI vs Physician register and existing answers."""
    known = {}
    try:
        for study in load(REVIEW_PATH).get("studies", []):
            if study.get("url"):
                known[agent.normalize_url(study["url"])] = {"title": study.get("title", ""), "source": study.get("source", ""),
                                                           "published": study.get("published", ""), "url": study["url"],
                                                           "finding": study.get("finding", "")}
    except (OSError, ValueError):
        pass
    try:
        for item in load(FAQ_PATH).get("items", []):
            for source in item.get("sources", []):
                known.setdefault(agent.normalize_url(source["url"]), dict(source))
    except (OSError, ValueError):
        pass
    return known


def pick_target(targets: dict, faq: dict) -> dict | None:
    existing = [item["question"] for item in faq["items"]]
    for target in sorted(targets["targets"], key=lambda t: (-int(t.get("priority", 0)), t.get("added", ""))):
        if target.get("status") != "open":
            continue
        if target.get("refresh_id"):
            if any(item["id"] == target["refresh_id"] for item in faq["items"]):
                return target
            target["status"], target["note"] = "skipped", "the answer to refresh no longer exists"
            continue
        if any(similarity(target["question"], q) >= SIMILAR for q in existing):
            target["status"], target["note"] = "skipped", "already answered by a similar question"
            continue
        return target
    return None


def build_prompt(target: dict | None, faq: dict, known: dict[str, dict], date: dt.date) -> str:
    categories = "\n".join(f'- "{c["id"]}": {c["name"]}' for c in faq["categories"])
    existing = "\n".join(f'- {item["question"]}' for item in faq["items"])
    register = "\n".join(f'- {k["title"]} ({k["source"]}, {k["published"]}): {k["url"]}'
                         for k in list(known.values())[:120])
    if target and target.get("refresh_id"):
        old = next(item for item in faq["items"] if item["id"] == target["refresh_id"])
        task = (f"REWRITE this existing answer from the best current evidence, keeping the same question.\n"
                f"Question: {old['question']}\nCurrent answer: {old['answer']}\n"
                f"Why it needs a refresh: {target.get('note') or target.get('reason') or 'newer evidence'}")
    elif target:
        task = (f"ANSWER this question (you may tighten its wording): {target['question']}\n"
                f"Category: {target.get('category', '')}. People search for: {', '.join(target.get('keywords', []))}")
    else:
        task = ("CHOOSE one question about AI in medicine, medical education with AI, AI in residency and "
                "fellowship applications, or building medical apps with AI that clinicians or trainees often ask search engines or AI assistants, that the FAQ does "
                "not answer yet, and that good evidence can answer. Prefer specific, long-tail questions. Then answer it.")
    return (f"Today is {date.isoformat()}.\n\n{task}\n\n"
            f"Categories:\n{categories}\n\n"
            f"Questions the FAQ already answers (do not duplicate them):\n{existing}\n\n"
            f"Already checked sources you may cite without searching (title, journal, date, link):\n{register}\n")


def verify(result: dict, found: set[str], known: dict[str, dict]) -> tuple[list[str], list[str]]:
    """Returns (problems that block the answer, warnings for the reviewer)."""
    problems, warnings = [], []
    answer = result.get("answer", "").strip()
    sources = result.get("sources", [])
    if not answer or not result.get("question", "").strip():
        problems.append("The answer or question is empty.")
    for n, source in enumerate(sources, 1):
        url = source.get("url", "")
        key = agent.normalize_url(url) if url.startswith("http") else ""
        if not key or (key not in found and key not in known):
            problems.append(f"Source [{n}] was not seen in this run's search results or the checked sources: {url}")
    cited = {int(m) for m in re.findall(r"\[(\d+)\]", answer)}
    if not cited:
        problems.append("The answer cites no sources.")
    if cited - set(range(1, len(sources) + 1)):
        problems.append(f"The answer cites sources that are not listed: {sorted(cited - set(range(1, len(sources) + 1)))}")
    unused = set(range(1, len(sources) + 1)) - cited
    if unused:
        warnings.append(f"Sources listed but not cited in the text: {sorted(unused)}")
    n_words = len(answer.split())
    if not MIN_WORDS <= n_words <= MAX_WORDS:
        warnings.append(f"The answer is {n_words} words (aim: 80 to 180).")
    return problems, warnings


REVISE_SYSTEM = """\
You are correcting a short FAQ answer about AI in medicine against the text \
of the sources it cites. You have no web access and must not use your own \
memory of any paper.

Rules:
- Keep the question, the [n] citation markers and the order of the sources. \
You may drop a source only if you also remove every sentence that cites it.
- Every number must appear in the text of the source its sentence cites, \
written exactly as that text writes it (same value, same units, same \
denominator: "30 out of 32", "44.3%"). Never round, combine or compute.
- If the text says something weaker than the answer (for example a "similar" \
rate, a subset, a non-significant difference), say what the text says.
- If a number cannot be found in its cited source's text, or that source's \
text is unavailable, remove the number or the claim rather than guess.
- Keep 80 to 180 words, the first sentence a direct plain answer, and the \
other rules of the original answer (no patient information, no personal \
medical advice).
- "note": what you changed and why, for the editors only.
"""


def source_texts(sources: list[dict], fixture: dict | None = None) -> dict[int, tuple[str, str]]:
    """{1-based source number: (kind, text)} for each source. kind is
    "full_text" or "abstract", or "" when the text could not be fetched (a
    non-PubMed page such as WHO guidance, a fetch failure, an empty abstract).
    In a fixture run the texts come from the fixture, never the network."""
    import living_review  # its paper_text uses NCBI's API (and medRxiv's for preprints)
    texts = {}
    for n, source in enumerate(sources, 1):
        if fixture is not None:
            text = (fixture.get("source_texts") or {}).get(source.get("url", ""), "")
            texts[n] = ("abstract" if text else "", text)
        else:
            texts[n] = living_review.paper_text({"url": source.get("url", "")})
    return texts


def revise_prompt(result: dict, texts: dict[int, tuple[str, str]]) -> str:
    parts = []
    for n, source in enumerate(result.get("sources", []), 1):
        kind, text = texts.get(n, ("", ""))
        label = {"full_text": "full text (PubMed Central)", "abstract": "abstract (PubMed)"}.get(kind, "")
        parts.append(f"[{n}] {source.get('title', '')} ({source.get('source', '')}) {source.get('url', '')}\n"
                     + (f"{label}:\n{text}" if text else "TEXT UNAVAILABLE: no number may be cited to this source."))
    return ("Correct this answer against the sources' text and return it in the required JSON format.\n\n"
            "The answer:\n" + json.dumps(result, ensure_ascii=False) + "\n\nThe sources' text:\n\n"
            + "\n\n".join(parts))


def number_lines(report: number_check.Report, sources: list[dict]) -> list[str]:
    """The reviewer's list: every number, where it was or wasn't found."""
    def name(n):
        return f"[{n}] {sources[n - 1]['title'][:90]}" if n and 0 < n <= len(sources) else "no source"
    lines = []
    for r in report.results:
        if r.status == "found":
            lines.append(f"- **{r.number}**: found in the text of {name(r.source)} (context not machine-checked): "
                         f"\"{r.excerpt}\"")
        elif r.status == "year":
            lines.append(f"- {r.number}: a year, not checked")
        else:
            cited = ", ".join(name(n) for n in r.cited) or "no source"
            lines.append(f"- **{r.number}: UNVERIFIED**, {r.reason}. Cited: {cited}. Sentence: \"{r.sentence}\"")
    return lines or ["- (no numbers)"]


def fact_check_warning(report: number_check.Report, sources: list[dict], texts: dict[int, tuple[str, str]]) -> str:
    """The NEEDS FACT-CHECK block (plain text, used first in the PR and the
    email), or "" when every number was found in its cited source's text."""
    if not report.needs_fact_check:
        return ""
    lines = [f"NEEDS FACT-CHECK: {len(report.unverified)} number(s) in this draft could not be matched to the "
             "text of the source they cite. A clinician or editor must check each one against the source, and "
             "correct or remove it, before this is merged.", ""]
    for r in report.unverified:
        lines.append(f"- {r.number}: {r.reason}.")
        lines.append(f"  Sentence: \"{r.sentence}\"")
        for n in r.cited or []:
            if 0 < n <= len(sources):
                kind = texts.get(n, ("", ""))[0] or "text unavailable"
                lines.append(f"  Source [{n}] ({kind}): {sources[n - 1]['title']} {sources[n - 1]['url']}")
    return "\n".join(lines)


def write_pr_body(path: Path, item: dict, target: dict | None, refresh: bool, warnings: list[str],
                  numbers: list[str], note: str, usage: dict | None, fact_check: str = "") -> None:
    lines = []
    if fact_check:
        head, _, rest = fact_check.partition("\n")
        lines += [f"> [!WARNING]", f"> **{head}**", *[f"> {l}" if l else ">" for l in rest.splitlines()], ""]
    lines += [
        f"## FAQ draft: {item['question']}",
        "",
        ("**A refreshed answer** to an existing question" if refresh else "**A new answer**") +
        f" for the [FAQ page]({SITE}/faq.html), written by the FAQ agent. **Merging publishes it**; closing skips it.",
        "",
        "### The answer",
        "",
        "> " + item["answer"],
        "",
        "### Sources",
        *[f"{n}. [{s['title']}]({s['url']}), {s['source']}{', ' + s['published'] if s.get('published') else ''}"
          for n, s in enumerate(item["sources"], 1)],
        "",
        "### Numbers, checked against the sources' text",
        "Each number was looked for, without AI, in the retrieved text of the source its sentence cites. "
        "\"Found\" means the same number appears there; check that it means the same thing (outcome, comparator, "
        "population, denominator). Every UNVERIFIED number must be checked against the source and corrected or "
        "removed before merging (docs/editorial/scientific-review.md, section 4). Clinical claims need a "
        "clinician's approval whatever this list says.",
        *numbers,
    ]
    if warnings:
        lines += ["", "### Warnings", *[f"- {w}" for w in warnings]]
    lines += ["", f"Category: {item['category']} · Keywords: {', '.join(item.get('keywords', []))}",
              f"Address after merging: {SITE}/faq.html#faq-{item['id']}"]
    if target:
        lines.append(f"From the target list (priority {target.get('priority', '?')}).")
    else:
        lines.append("The target list was empty, so the agent chose this question.")
    if note:
        lines += ["", f"<sub>Agent's note: {note}</sub>"]
    if usage:
        lines += ["", f"<sub>Drafted by `{agent.MODEL}`: {usage['searches']} web searches, "
                      f"about ${agent.estimate_cost(usage):.2f}.</sub>"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Defaults to today (US Eastern)")
    parser.add_argument("--pr-body", type=Path, help="Where to write the PR description")
    parser.add_argument("--fixture", type=Path, help="Test without the API (see the docstring)")
    parser.add_argument("--fact-check-file", type=Path,
                        help="Where to write the NEEDS FACT-CHECK warning (empty when every number was found)")
    args = parser.parse_args()

    date = args.date or agent.today_eastern()
    agent.set_output("date", date.isoformat())
    faq, targets = load(FAQ_PATH), load(TARGETS_PATH)
    known = checked_sources()
    target = pick_target(targets, faq)
    refresh = bool(target and target.get("refresh_id"))
    print(f"Target: {target['question'] if target else '(none: the agent chooses)'}")

    fixture = json.loads(args.fixture.read_text(encoding="utf-8")) if args.fixture else None
    answer_schema = schema([c["id"] for c in faq["categories"]])
    if fixture is not None:
        result, usage = fixture["result"], None
        found = {agent.normalize_url(u) for u in fixture.get("search_urls", [])}
    else:
        result, found, usage = agent.run_claude(
            build_prompt(target, faq, known, date), system=SYSTEM, schema=answer_schema, tools=TOOLS)
        print(f"About ${agent.estimate_cost(usage):.2f}, {usage['searches']} searches.")

    # Fetch the cited sources' own text, and have the answer corrected against
    # it with no web access, before anything is checked or written (#185).
    texts = source_texts(result.get("sources", []), fixture)
    by_url = {s.get("url", ""): texts[n] for n, s in enumerate(result.get("sources", []), 1)}
    print("Source text: " + ", ".join(f"[{n}] {k or 'unavailable'}" for n, (k, _) in texts.items()))
    if fixture is not None:
        result = fixture.get("revised") or result
    elif any(text for _, text in texts.values()):
        revised, _, more = agent.run_claude(revise_prompt(result, texts), system=REVISE_SYSTEM,
                                            schema=answer_schema, tools=[])
        result = revised
        usage = {k: usage[k] + more.get(k, 0) for k in usage}
        print(f"Corrected against the sources' text; about ${agent.estimate_cost(usage):.2f} in all.")

    problems, warnings = verify(result, found, known)
    others = [item for item in faq["items"] if not (refresh and item["id"] == target["refresh_id"])]
    close = [item["question"] for item in others if similarity(result.get("question", ""), item["question"]) >= SIMILAR]
    if close:
        problems.append(f"Too close to an existing question: {close[0]}")
    if problems:
        print("Not used:\n- " + "\n- ".join(problems))
        if args.pr_body:
            args.pr_body.write_text("No FAQ answer was drafted today.\n\n" + "\n".join(f"- {p}" for p in problems)
                                    + (f"\n\nAgent's note: {result.get('note', '')}" if result.get("note") else "") + "\n",
                                    encoding="utf-8")
        save(TARGETS_PATH, targets)   # keeps any targets marked skipped
        agent.set_output("created", "false")
        return 0

    sources = [{k: s.get(k, "") for k in ("title", "url", "source", "published")} for s in result["sources"]]
    if refresh:
        item = next(i for i in faq["items"] if i["id"] == target["refresh_id"])
        item.update(answer=result["answer"].strip(), sources=sources, keywords=result.get("keywords", item.get("keywords", [])),
                    updated=date.isoformat())
    else:
        item = {"id": slug(result["question"], {i["id"] for i in faq["items"]}), "category": result["category"],
                "question": result["question"].strip(), "answer": result["answer"].strip(), "sources": sources,
                "keywords": result.get("keywords", [])[:6], "added": date.isoformat(), "updated": date.isoformat()}
        faq["items"].append(item)
    faq["updated"] = date.isoformat()
    if target:
        target.update(status="answered", answered_id=item["id"], answered=date.isoformat())
    save(FAQ_PATH, faq)
    save(TARGETS_PATH, targets)
    print(f"{'Refreshed' if refresh else 'Added'} faq-{item['id']}")

    # Every number against the text of the source its sentence cites (#185)
    final_texts = {n: by_url.get(s["url"], ("", "")) for n, s in enumerate(sources, 1)}
    report = number_check.check(item["answer"], {n: t for n, (_, t) in final_texts.items()})
    warning = fact_check_warning(report, sources, final_texts)
    print(f"Numbers: {sum(r.status == 'found' for r in report.results)} found, "
          f"{len(report.unverified)} unverified" + (" -> NEEDS FACT-CHECK" if warning else ""))
    if args.fact_check_file:
        args.fact_check_file.write_text(warning + ("\n" if warning else ""), encoding="utf-8")
    agent.set_output("needs_fact_check", "true" if warning else "false")
    if args.pr_body:
        write_pr_body(args.pr_body, item, target, refresh, warnings, number_lines(report, sources),
                      result.get("note", ""), usage, warning)
    agent.set_output("faq_id", item["id"])
    agent.set_output("created", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())

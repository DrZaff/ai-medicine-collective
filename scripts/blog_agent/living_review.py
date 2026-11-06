"""The living review "AI vs Physician": how AI changes what physicians can do.

Runs once a month (owner's request, 2026-11-06: go deeper every month):

  0. Deepen   read more PubMed abstracts in priority order (deep_sweep.py,
              --sweep-budget, default $8), then take the next best clinical
              studies from the deep sweep's shortlists (--promote, default 8)
              and check each against its paper (full text from PubMed
              Central where it is open access, else the PubMed abstract,
              both fetched through NCBI's API) before it joins the register as a
              landmark study. --mode landmarks adds every proposed landmark
              at once and skips the searches (used to rebuild the paper).
  1. Search   find studies published since the last edition that measure AI
              against clinicians, or clinicians with AI against clinicians
              without it, and record each one in a fixed form.
  2. Write    rewrite the paper from the full register of studies, citing
              each claim as [S12]. This request has no web access: the paper
              can only draw on studies already in the register.

The result is evidence/ai-vs-human.json (the register and the paper together).
The workflow (.github/workflows/living-review.yml) opens a pull request;
merging it is the human review step that publishes the edition. The page
ai-vs-physician.html draws it (initLivingReview in script.js).

Safeguards: a study is kept only if its link appeared in that run's search
results and is not already in the register; head-to-head reviews already
published on the blog are added to the register without a search; citations
to studies that are not in the register are removed from the paper.

Usage:
    python scripts/blog_agent/living_review.py [--date YYYY-MM-DD] [--pr-body PATH]
    python scripts/blog_agent/living_review.py --mode landmarks [--pr-body PATH]
    python scripts/blog_agent/living_review.py --fixture sample.json [--mode ...]   # no API call
        sample.json: {"search": {"result": {...}, "search_urls": [...]}, "write": {"result": {...}},
                      "verify": {"result": {<one checked record, used for every study>}}}
        (with a fixture, the monthly mode does not read new abstracts: that needs PubMed)

Needs ANTHROPIC_API_KEY in the environment (a GitHub Actions secret in CI).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # the blog agent: the Claude request, link checking, cost estimate  # noqa: E402

ROOT = agent.ROOT
REVIEW_PATH = ROOT / "evidence" / "ai-vs-human.json"

# How far back each search looks. The first edition has to build the register;
# later ones overlap the month before, so a late-indexed paper is not missed.
FIRST_LOOKBACK_DAYS = 365
LOOKBACK_DAYS = 50
FIRST_MAX_STUDIES = 20
MAX_STUDIES = 10

# Search budgets (fetched pages are the main cost).
FIRST_TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 40},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 14, "max_content_tokens": 6000},
]
MONTHLY_TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 18},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 8, "max_content_tokens": 5000},
]

DOMAINS = ["diagnosis", "imaging", "management", "documentation", "communication",
           "education", "procedures", "other"]
COMPARISONS = ["ai_alone", "clinician_with_ai", "both"]
# ai_alone studies: who came out ahead. clinician_with_ai studies: what the help did.
VERDICTS = ["ai_ahead", "humans_ahead", "comparable",
            "ai_help_improved", "ai_help_no_benefit", "ai_help_harmed", "mixed"]
VERDICT_LABELS = {
    "ai_ahead": "AI outperformed physicians", "humans_ahead": "Physicians outperformed AI", "comparable": "Comparable",
    "ai_help_improved": "AI helped improve", "ai_help_no_benefit": "AI help made no difference",
    "ai_help_harmed": "AI help made things worse", "mixed": "Mixed results",
}

STUDY_FIELDS = {
    "title": "The paper's title, exactly",
    "url": "The article, PubMed or preprint page you found",
    "source": "Journal or preprint server",
    "published": "YYYY-MM-DD",
    "domain": None,
    "comparison": None,
    "design": "Study design in a few words, e.g. 'randomised trial', 'retrospective reader study', 'vignette study'",
    "ai_system": "Which AI system was tested",
    "humans": "Who the humans were and how many",
    "finding": "2 to 3 sentences: the task, the main measure, and each side's result with numbers exactly as reported",
    "limitation": "The most important limitation, in one sentence",
    "verdict": None,
}

SEARCH_SYSTEM = """\
You keep the register of studies behind "AI vs Physician", a living review \
published by the AI Medicine Collective (residents and faculty) on how AI \
changes what physicians can do. Each month you add the new studies.

A study belongs in the register only if all of these are true:
- It is a real study: a peer-reviewed article, or a preprint clearly labelled \
as one. Not a press release on its own, not vendor marketing, not an opinion \
piece, not a news story about a study you could not find.
- It measures physician-level performance on a medical task and reports a \
quantitative comparison of one of these kinds: (a) an AI system on its own \
against clinicians, trainees or students; (b) clinicians working with an AI \
against clinicians working without it; (c) what happens to clinicians' own \
performance after using AI (over-reliance, automation bias, loss of skill, \
or skill gained).
- A study that only compares AI systems with each other does not qualify.

Rules:
- Use web search to find studies. Prefer the journal page, PubMed, PubMed \
Central or the preprint server. Search across specialties and across the \
three kinds of comparison; do not fill the register with one specialty.
- Every study must link to a URL you actually found with your search tools \
in this conversation. Never construct, guess, or shorten a URL.
- Report what the paper says. Numbers exactly as reported, with their units. \
Do not invent sample sizes, numbers, or conclusions. If you could not confirm \
a detail, leave the study out.
- "verdict" comes from the study's own main result. For AI-on-its-own \
studies use ai_ahead, humans_ahead or comparable. For studies of clinicians \
with and without AI use ai_help_improved, ai_help_no_benefit or \
ai_help_harmed. Use mixed when the answer depends on the subgroup, task or \
measure. Do not call a winner the authors did not report.
- Never include patient-identifiable information.
- Do not repeat a study that is already in the register (you are given the list).
- Prefer the strongest and most informative studies: randomised and \
prospective designs, real clinical settings, larger samples, and results \
that change the picture, including negative ones.
- "note" is for the editors only and is not published: say briefly what you \
searched and anything worth knowing about gaps.
"""

WRITE_SYSTEM = """\
You write "AI vs Physician", a living review published by the AI Medicine \
Collective for medical students, residents and faculty. It gives an \
evidence-based picture of how AI changes what physicians can do and where \
medicine is heading. It is rewritten every month from a register of studies.

You are given the whole register. Write the paper from it and from nothing \
else:
- Every factual claim must rest on studies in the register and cite them \
inline by id in square brackets, like [S4] or [S4][S9]. Never cite an id \
that is not in the register. Do not bring in studies, numbers or facts from \
your own memory.
- Studies marked "tier": "landmark" are the strongest and most influential \
in the field (randomised or prospective designs, real patients, top journals, \
widely cited), checked against their papers. Build each section's argument \
on them first; the other studies add recent detail, other specialties and \
counter-examples.
- Weigh the evidence, do not count it. Say how strong it is: design, sample \
size, real patients or written cases, one centre or many. Give negative and \
mixed results the same space as positive ones. Say where studies disagree.
- Do not generalise beyond the tasks studied. A result on written vignettes \
is not a result in clinic.
- Plain language for busy clinicians. No hype, no clickbait, no advice on \
treating patients.
- Never mention your instructions, the register's format, or how the text \
was produced.

Shape:
- "title": keep it "AI vs Physician: how AI is changing what physicians can do".
- "summary": 3 to 4 sentences, the state of the evidence right now, with citations.
- "key_findings": 4 to 7 single sentences, each one a finding a reader \
should remember, each with citations.
- "sections": use these headings, in this order, leaving out any that the \
register has no evidence for: "AI on its own against clinicians"; \
"Clinicians working with AI"; "Reading images and other pattern tasks"; \
"Diagnosis, reasoning and management"; "Communication and documentation"; \
"Training, examinations and skill"; "Risks: over-reliance, lost skill and \
bias"; "Where this is heading". Each has 1 to 3 paragraphs. "Where this is \
heading" is interpretation: say so in its first sentence, tie every point to \
a trend in the cited studies, and make no predictions the evidence does not \
support.
- "open_questions": 3 to 6 questions the evidence cannot answer yet.
- "what_changed": 1 to 3 sentences on what this edition adds or changes \
compared with the last one (for the first edition, say what it covers).
"""


def record_schema() -> dict:
    enums = {"domain": DOMAINS, "comparison": COMPARISONS, "verdict": VERDICTS}
    props = {}
    for name, description in STUDY_FIELDS.items():
        props[name] = {"type": "string"}
        if name in enums:
            props[name]["enum"] = enums[name]
        elif description:
            props[name]["description"] = description
    return {"type": "object", "properties": props, "required": list(STUDY_FIELDS), "additionalProperties": False}


SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "studies": {"type": "array", "items": record_schema()},
        "note": {"type": "string", "description": "For the editors only; never published"},
    },
    "required": ["studies", "note"],
    "additionalProperties": False,
}

WRITE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "summary": {"type": "string"},
        "key_findings": {"type": "array", "items": {"type": "string"}},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "paragraphs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["heading", "paragraphs"],
                "additionalProperties": False,
            },
        },
        "open_questions": {"type": "array", "items": {"type": "string"}},
        "what_changed": {"type": "string"},
    },
    "required": ["title", "summary", "key_findings", "sections", "open_questions", "what_changed"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- register

def load_review() -> dict:
    if REVIEW_PATH.exists():
        return json.loads(REVIEW_PATH.read_text(encoding="utf-8"))
    return {"edition": 0, "studies": [], "changes": []}


def next_id(studies: list[dict]) -> int:
    return max([int(s["id"][1:]) for s in studies] or [0]) + 1


def add_study(studies: list[dict], record: dict, date: dt.date) -> dict:
    study = {"id": f"S{next_id(studies)}", **{k: str(record.get(k, "")).strip() for k in STUDY_FIELDS},
             "added": date.isoformat()}
    studies.append(study)
    return study


def from_blog(studies: list[dict], date: dt.date) -> list[dict]:
    """Head-to-head reviews already published on the blog join the register
    as they are: a person has already checked them."""
    known = {agent.normalize_url(s["url"]) for s in studies}
    added = []
    for path in sorted(agent.POSTS_DIR.glob("*.json")):
        post = json.loads(path.read_text(encoding="utf-8"))
        for item in post.get("items", []):
            key = agent.normalize_url(item.get("url", ""))
            if item.get("section") != "ai_vs_human" or not key or key in known:
                continue
            known.add(key)
            verdict = item.get("verdict") if item.get("verdict") in VERDICTS else "mixed"
            added.append(add_study(studies, {
                "title": item["title"], "url": item["url"], "source": item["source"],
                "published": item["published"], "domain": "other", "comparison": "both",
                "design": "", "ai_system": "", "humans": "",
                "finding": item["summary"], "limitation": "", "verdict": verdict,
            }, date))
    return added


def verify_studies(result: dict, found_urls: set[str], studies: list[dict], limit: int) -> tuple[list[dict], list[str]]:
    """Keep studies whose link appeared in the search results, that are new,
    and that have every field. Returns (kept records, reasons for the rest)."""
    known = {agent.normalize_url(s["url"]) for s in studies}
    kept, dropped = [], []
    for record in result.get("studies", []):
        title = record.get("title", "?")
        url = record.get("url", "")
        key = agent.normalize_url(url) if url.startswith(("http://", "https://")) else ""
        if not key:
            dropped.append(f"{title}: not a web link")
        elif key not in found_urls:
            dropped.append(f"{title}: link not found in search results ({url})")
        elif key in known:
            dropped.append(f"{title}: already in the register")
        elif record.get("verdict") not in VERDICTS or record.get("domain") not in DOMAINS \
                or record.get("comparison") not in COMPARISONS:
            dropped.append(f"{title}: missing its domain, comparison or verdict")
        elif not re.fullmatch(r"\d{4}-\d{2}-\d{2}", record.get("published", "")):
            dropped.append(f"{title}: no publication date")
        elif len(kept) >= limit:
            dropped.append(f"{title}: over this edition's limit of {limit} new studies")
        else:
            known.add(key)
            kept.append(record)
    return kept, dropped


# ---------------------------------------------------------------- landmark studies

# Studies promoted from the deep sweep's shortlists. Their records were made
# from abstracts, so each is checked against the paper itself before it joins
# the register. The text comes from NCBI's own API, not from web pages: the
# full text from PubMed Central when the paper is open access there, else the
# PubMed abstract. (The first try, on 2026-11-06, let Claude open the pages
# itself; PubMed showed it CAPTCHAs and publishers blocked it, so 30 of 40
# studies could not be checked.)
VERIFY_WORKERS = 4
MAX_PAPER_CHARS = 80000    # about 20,000 tokens of full text per study
MONTHLY_PROMOTE = 8        # studies added from the shortlists each month
MONTHLY_SWEEP_BUDGET = 8.0  # dollars for reading new abstracts each month
VERIFY_BUDGET = 15.0        # dollars for checking studies against their papers
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"

VERIFY_SYSTEM = SEARCH_SYSTEM.split("Rules:")[0] + """\
You are checking a study that a screening pass recorded from its abstract. \
You are given the paper's text (the full text where it is open access, else \
the abstract) and the screening record. Return a corrected record from what \
the text says, and nothing else.

Rules:
- Every number exactly as the paper reports it, with its units. Never compute \
or round. Do not add anything the text does not say, and do not use your own \
memory of the paper.
- "finding": 3 to 5 sentences in this order: the task; the AI system; who the \
clinicians were and how many; the main result for each side with numbers; \
the main limitation. Plain language for clinicians.
- "verdict" from the paper's own main result. For AI-on-its-own studies use \
ai_ahead, humans_ahead or comparable; for clinicians with and without AI use \
ai_help_improved, ai_help_no_benefit or ai_help_harmed; mixed when the \
answer depends on the subgroup, task or measure.
- "status": confirmed (the record was right), corrected (you fixed it) or \
does_not_qualify (the paper does not compare AI with clinicians as defined \
above, for example the comparator is not AI or no clinicians took part).
- "note": one sentence for the editors on what you corrected or why it does \
not qualify. Never published.
- Never include patient-identifiable information.
"""


def verify_schema() -> dict:
    record = record_schema()
    fields = ["status", "note", *[k for k in STUDY_FIELDS if k not in ("title", "url", "source", "published")]]
    props = {k: v for k, v in record["properties"].items() if k in fields}
    props.update({
        "status": {"type": "string", "enum": ["confirmed", "corrected", "does_not_qualify"]},
        "note": {"type": "string"},
    })
    return {"type": "object", "properties": props, "required": fields, "additionalProperties": False}


def _text(node) -> str:
    return " ".join(" ".join(node.itertext()).split()) if node is not None else ""


def paper_text(st: dict) -> tuple[str, str]:
    """The paper's text from NCBI: ("full_text", text) from PubMed Central when
    it is open access there, else ("abstract", text) from PubMed, else ("", "")."""
    import time
    import xml.etree.ElementTree as ET
    import deep_sweep  # its get() retries and identifies the client
    pmid = re.search(r"pubmed\.ncbi\.nlm\.nih\.gov/(\d+)", st.get("url", ""))
    if not pmid:
        return "", ""
    pmid = pmid.group(1)
    common = "tool=amc-living-review&email=noreply@aimedicinecollective.com"
    try:
        links = json.loads(deep_sweep.get(f"{EUTILS}elink.fcgi?dbfrom=pubmed&db=pmc&id={pmid}&retmode=json&{common}"))
        time.sleep(0.4)
        pmc = [i for ls in links.get("linksets", []) for db in ls.get("linksetdbs", [])
               if db.get("linkname") == "pubmed_pmc" for i in db.get("links", [])]
        if pmc:
            root = ET.fromstring(deep_sweep.get(f"{EUTILS}efetch.fcgi?db=pmc&id={pmc[0]}&retmode=xml&{common}"))
            time.sleep(0.4)
            body = root.find(".//body")
            if body is not None and len(_text(body)) > 2000:
                abstract = _text(root.find(".//abstract"))
                tables = " ".join(_text(t) for t in root.iter("table-wrap"))
                text = f"ABSTRACT: {abstract}\n\nFULL TEXT: {_text(body)}\n\nTABLES: {tables}"
                return "full_text", text[:MAX_PAPER_CHARS]
        root = ET.fromstring(deep_sweep.get(f"{EUTILS}efetch.fcgi?db=pubmed&id={pmid}&retmode=xml&{common}"))
        time.sleep(0.4)
        abstract = " ".join(_text(a) for a in root.iter("AbstractText"))
        return ("abstract", abstract) if len(abstract) > 200 else ("", "")
    except Exception as err:  # one paper that cannot be fetched should not stop the edition
        print(f"Could not fetch PMID {pmid}: {err}")
        return "", ""


def verify_prompt(st: dict, kind: str, text: str) -> str:
    return (
        "Check this study against its paper and return the corrected record.\n\n"
        + json.dumps({"title": st["title"], "journal": st["source"], "published": st["published"],
                      "recorded_from_abstract": {k: st.get(k, "") for k in
                                                 ("domain", "comparison", "design", "ai_system", "humans",
                                                  "finding", "limitation", "verdict")}}, ensure_ascii=False)
        + f"\n\nThe paper ({'full text from PubMed Central' if kind == 'full_text' else 'abstract only, from PubMed'}):\n"
        + text + "\n\nReturn the record in the required JSON format.")


def verify_landmarks(chosen: list[dict], budget: float, fixture: dict | None = None):
    """Check the chosen shortlist studies against their papers. Returns (records
    ready for the register, reasons for the ones left out, usage, the
    (url, reason) of studies found not to qualify)."""
    import concurrent.futures as cf
    usage, kept, dropped, rejected, spent, per_study = None, [], [], [], 0.0, 0.0

    # Fetch every paper first (NCBI asks for a few requests a second at most)
    papers = []
    for st in chosen:
        kind, text = ("full_text", "Fixture text.") if fixture is not None else paper_text(st)
        if not text:
            dropped.append(f"{st['title']}: its text could not be fetched from PubMed; it stays in the queue")
        else:
            papers.append((st, kind, text))
    print(f"Fetched {len(papers)} of {len(chosen)} papers "
          f"({sum(1 for p in papers if p[1] == 'full_text')} full text, the rest abstracts)")

    def run(st, kind, text):
        if fixture is not None:
            return fixture["result"], {"input": 1000, "output": 100, "cache_read": 0, "cache_write": 0, "searches": 0}
        result, _, used = agent.run_claude(verify_prompt(st, kind, text), system=VERIFY_SYSTEM,
                                           schema=verify_schema(), tools=[])
        return result, used

    with cf.ThreadPoolExecutor(max_workers=VERIFY_WORKERS) as pool_:
        pending, queue = {}, list(papers)
        while queue or pending:
            while queue and len(pending) < VERIFY_WORKERS and spent + per_study * (len(pending) + 1) <= budget:
                item = queue.pop(0)
                pending[pool_.submit(run, *item)] = item
                if per_study == 0.0:
                    break
            if not pending:
                break
            done, _ = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
            for future in done:
                st, kind, _ = pending.pop(future)
                try:
                    row, used = future.result()
                except BaseException as err:  # one failed check is reported, not fatal
                    dropped.append(f"{st['title']}: the check failed ({err}); it stays in the queue")
                    continue
                usage = agent.add_usage(usage, used)
                spent = agent.estimate_cost(usage)
                per_study = max(per_study, spent / max(1, len(kept) + len(rejected) + 1))
                if row.get("status") == "does_not_qualify":
                    rejected.append((st["url"], str(row.get("note", "")).strip()))
                    dropped.append(f"{st['title']}: does not qualify ({row.get('note', '').strip()})")
                elif row.get("verdict") not in VERDICTS or row.get("domain") not in DOMAINS \
                        or row.get("comparison") not in COMPARISONS or not str(row.get("finding", "")).strip():
                    dropped.append(f"{st['title']}: the checked record was incomplete; it stays in the queue")
                else:
                    kept.append({**{k: row.get(k, "") for k in STUDY_FIELDS},
                                 "title": st["title"], "url": st["url"], "source": st["source"],
                                 "published": st["published"],
                                 "_extra": {"tier": "landmark", "checked": kind,
                                            "check_status": row.get("status"),
                                            "check_note": str(row.get("note", "")).strip()}})
    dropped += [f"{st['title']}: not checked this time (budget reached); it stays in the queue" for st, _, _ in queue]
    return kept, dropped, usage, rejected


# ---------------------------------------------------------------- prompts

def search_prompt(date: dt.date, studies: list[dict], first: bool) -> str:
    days = FIRST_LOOKBACK_DAYS if first else LOOKBACK_DAYS
    limit = FIRST_MAX_STUDIES if first else MAX_STUDIES
    start = date - dt.timedelta(days=days)
    have = "\n".join(f"- {s['title']} ({s['url']})" for s in studies) or "(none yet)"
    opening = (
        "This is the first edition, so you are building the register. Aim for a "
        "balanced set across specialties and across the three kinds of comparison."
        if first else "Add the studies published since the last edition."
    )
    return (
        f"Today is {date.isoformat()}. {opening}\n\n"
        f"Window: published from {start.isoformat()} through {date.isoformat()}.\n"
        f"Return at most {limit} studies, the strongest and most informative first. "
        "Fewer is fine; an empty list is fine if nothing new qualifies.\n\n"
        f"Already in the register (do not repeat):\n{have}\n\n"
        "Search ideas: large language model versus physicians on diagnosis or "
        "management; randomised trials of clinicians with and without AI "
        "assistance; AI versus radiologists, pathologists, dermatologists, "
        "ophthalmologists or endoscopists; AI scribes and documentation quality "
        "or time; AI replies to patient messages versus clinicians; AI versus "
        "residents or students on examinations; automation bias, over-reliance "
        "and deskilling among clinicians using AI. Journals such as JAMA, JAMA "
        "Network Open, NEJM AI, The Lancet Digital Health, Nature Medicine, npj "
        "Digital Medicine, Radiology, BMJ and Annals of Internal Medicine, and "
        "medRxiv.\n\nThen return the studies in the required JSON format."
    )


def write_prompt(date: dt.date, review: dict, new_ids: list[str]) -> str:
    register = json.dumps(
        [{k: v for k, v in s.items() if k not in ("url", "added", "checked", "check_status", "check_note") and v}
         for s in review["studies"]],
        indent=1, ensure_ascii=False)
    previous = review.get("summary")
    return (
        f"Today is {date.isoformat()}. Write edition {review['edition']} of the paper.\n\n"
        + (f"New in the register this month: {', '.join(new_ids)}.\n\n" if new_ids and previous else "")
        + (f"The last edition's summary, for comparison only:\n{previous}\n\n" if previous else "This is the first edition.\n\n")
        + f"The register ({len(review['studies'])} studies):\n{register}\n\n"
        "Return the paper in the required JSON format."
    )


# ---------------------------------------------------------------- the paper

CITE = re.compile(r"\[S(\d+)\]")


def clean_citations(paper: dict, studies: list[dict]) -> list[str]:
    """Remove citations to studies that are not in the register. Returns the
    ids removed, for the pull request."""
    known = {s["id"] for s in studies}
    removed: set[str] = set()

    def fix(text: str) -> str:
        def swap(match):
            if f"S{match.group(1)}" in known:
                return match.group(0)
            removed.add(f"S{match.group(1)}")
            return ""
        return re.sub(r" {2,}", " ", CITE.sub(swap, str(text))).strip()

    paper["summary"] = fix(paper.get("summary", ""))
    paper["key_findings"] = [fix(t) for t in paper.get("key_findings", []) if str(t).strip()]
    paper["open_questions"] = [fix(t) for t in paper.get("open_questions", []) if str(t).strip()]
    paper["sections"] = [
        {"heading": str(sec.get("heading", "")).strip(), "paragraphs": [fix(p) for p in sec.get("paragraphs", []) if str(p).strip()]}
        for sec in paper.get("sections", [])
    ]
    paper["sections"] = [sec for sec in paper["sections"] if sec["heading"] and sec["paragraphs"]]
    return sorted(removed, key=lambda i: int(i[1:]))


def uncited(paper: dict) -> list[str]:
    """Key findings and paragraphs that carry no citation at all: listed in
    the pull request so the reviewer looks at them first."""
    texts = [*paper["key_findings"], *(p for sec in paper["sections"] for p in sec["paragraphs"])]
    return [agent_short(t) for t in texts if not CITE.search(t)]


def agent_short(text: str, limit: int = 110) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def write_pr_body(path: Path, review: dict, new: list[dict], dropped: list[str], removed: list[str],
                  flagged: list[str], note: str, usage: dict | None, deep: dict | None = None) -> None:
    lines = [
        f"## AI vs Physician: edition {review['edition']} ({review['updated']})",
        "",
        review["summary"],
        "",
        f"**{len(review['studies'])} studies in the register, {len(new)} new this edition.** "
        "Merging publishes this edition on the AI vs Physician page.",
        "",
        "### New studies (check each one against its source)",
    ]
    checked = {"full_text": "checked against the full text", "abstract": "checked against the abstract only"}
    for study in new:
        lines += [
            f"- **{study['id']}: {study['title']}** — {study['source']}, {study['published']} "
            f"(`{VERDICT_LABELS[study['verdict']]}`)"
            + (f" · landmark, {checked.get(study.get('checked'), 'checked')}"
               + (", corrected" if study.get("check_status") == "corrected" else "") if study.get("tier") else ""),
            *([f"  - *Check:* {study['check_note']}"] if study.get("check_note") else []),
            f"  - {study['url']}",
            f"  - {study['finding']}",
            *([f"  - *Limitation:* {study['limitation']}"] if study["limitation"] else []),
        ]
    if not new:
        lines.append("- None: the paper was rewritten from the existing register.")
    if flagged:
        lines += ["", "### Sentences with no citation (read these first)", *[f"- {t}" for t in flagged]]
    if deep:
        sweep = deep.get("sweep")
        lines += ["", "### Going deeper (deep sweep)"]
        if sweep:
            lines.append(f"- Read {sweep.get('screened', 0)} more abstracts (about ${sweep.get('cost', 0):.2f}); "
                         f"{sweep.get('qualifying', 0)} qualified"
                         + (f" and were saved to `{sweep['path']}`" if sweep.get("path") else "") + ". "
                         f"{max(0, sweep.get('fresh', 0) - sweep.get('screened', 0))} candidates are still unread.")
        lines.append(f"- Added from the shortlists: {len(deep.get('added', []))}, each checked against its paper. "
                     f"{deep.get('waiting', 0)} clinical studies are waiting for later editions.")
        if deep.get("dropped"):
            lines += ["- Not added (they stay in the queue unless they do not qualify):",
                      *[f"  - {d}" for d in deep["dropped"]]]
    if removed:
        lines += ["", "### Citations removed automatically",
                  f"- The draft cited {', '.join(removed)}, which are not in the register."]
    if dropped:
        lines += ["", "### Studies left out automatically", *[f"- {d}" for d in dropped]]
    if note:
        lines += ["", "### Note from the agent (not published)", f"- {note}"]
    lines += [
        "",
        "### Before merging",
        "- [ ] Each new study: the link works, and the numbers and verdict match the paper",
        "- [ ] The summary and key findings say no more than the studies support",
        "- [ ] No patient information; nothing that reads as clinical advice",
        "- [ ] The Instagram slides in `social/review-<date>/` say what the paper says (merging posts them)",
        "",
        "To skip this edition, close this PR without merging.",
    ]
    if usage is not None:
        lines += ["", f"<sub>Drafted by `{agent.MODEL}`: "
                      f"{usage['input'] + usage['cache_read'] + usage['cache_write']:,} input tokens, "
                      f"{usage['output']:,} output tokens, {usage['searches']} web searches, "
                      f"about ${agent.estimate_cost(usage):.2f}.</sub>"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Defaults to today (US Eastern)")
    parser.add_argument("--pr-body", type=Path, help="Where to write the PR description")
    parser.add_argument("--fixture", type=Path, help="Test without the API (see the top of this file)")
    parser.add_argument("--mode", choices=["monthly", "landmarks", "search"], default="monthly",
                        help="monthly: read more abstracts, add the next best studies from the shortlists, "
                             "and search the web for new ones (the default); landmarks: add every proposed "
                             "landmark study not yet in the paper, no searching; search: web search only")
    parser.add_argument("--promote", type=int, default=MONTHLY_PROMOTE,
                        help=f"monthly mode: how many shortlist studies to add (default {MONTHLY_PROMOTE})")
    parser.add_argument("--sweep-budget", type=float, default=MONTHLY_SWEEP_BUDGET,
                        help=f"monthly mode: dollars for reading new abstracts (default {MONTHLY_SWEEP_BUDGET:.0f})")
    args = parser.parse_args()

    date: dt.date = args.date or agent.today_eastern()
    agent.set_output("date", date.isoformat())
    fixture = json.loads(args.fixture.read_text(encoding="utf-8")) if args.fixture else None

    review = load_review()
    first = not review["studies"]
    studies = review["studies"]
    new = from_blog(studies, date)
    usage = None
    deep: dict | None = None
    dropped: list[str] = []
    note = ""

    # 1a. Go deeper into the literature (owner's request, 2026-11-06): read
    # more abstracts, then add the best studies from the shortlists, each
    # checked against its paper. The landmarks mode adds every proposed
    # landmark at once (used to rebuild the paper on them).
    if args.mode in ("monthly", "landmarks"):
        import deep_sweep  # imported here: it imports this module too
        deep = {"mode": args.mode}
        if args.mode == "monthly" and fixture is None:
            sweep = deep_sweep.monthly_sweep(date, args.sweep_budget)
            usage = agent.add_usage(usage, sweep.pop("usage", None))
            deep["sweep"] = sweep
        waiting = deep_sweep.pool(studies)
        chosen = [st for st in waiting if st.get("proposed_tier") == "landmark" or st.get("pin") == "landmark"] \
            if args.mode == "landmarks" else waiting[:args.promote]
        deep["waiting"] = len(waiting) - len(chosen)
        if chosen:
            records, deep["dropped"], used, rejected = verify_landmarks(
                chosen, VERIFY_BUDGET, fixture.get("verify") if fixture is not None else None)
            usage = agent.add_usage(usage, used)
            deep_sweep.record_rejected(rejected, date)
            deep["added"] = []
            for record in records:
                extra = record.pop("_extra")
                study = add_study(studies, record, date)
                study.update(extra)
                deep["added"].append(study)
            new += deep["added"]
        for reason in deep.get("dropped", []):
            print(f"Not added from the shortlist: {reason}")

    # 1b. Search the web for studies too new to be in PubMed
    if args.mode in ("monthly", "search"):
        if fixture is not None:
            result = fixture["search"]["result"]
            found_urls = {agent.normalize_url(u) for u in fixture["search"].get("search_urls", [])}
        else:
            result, found_urls, more = agent.run_claude(
                search_prompt(date, studies, first), system=SEARCH_SYSTEM, schema=SEARCH_SCHEMA,
                tools=FIRST_TOOLS if first else MONTHLY_TOOLS)
            usage = agent.add_usage(usage, more)
        kept, dropped = verify_studies(result, found_urls, studies, FIRST_MAX_STUDIES if first else MAX_STUDIES)
        new += [add_study(studies, record, date) for record in kept]
        for reason in dropped:
            print(f"Left out: {reason}")
        note = str(result.get("note", "")).strip()

    if not studies:
        print("No studies in the register; nothing to write.")
        agent.set_output("created", "false")
        return 0
    if not new and review.get("sections"):
        print("No new studies this month; the published edition stands.")
        sweep = (deep or {}).get("sweep") or {}
        if sweep.get("screened") or (deep or {}).get("dropped"):
            # Save the sweep's progress (what was read, what was found) anyway
            if args.pr_body:
                args.pr_body.write_text("\n".join([
                    f"## AI vs Physician: deep sweep progress ({date.isoformat()})", "",
                    "No study was added to the paper this month, so the published edition stands. This saves "
                    "what the monthly sweep read, so next month goes further. Merging changes nothing on the site.",
                    "", f"- Read {sweep.get('screened', 0)} more abstracts (about ${sweep.get('cost', 0):.2f}); "
                    f"{sweep.get('qualifying', 0)} qualified.",
                    *[f"- Not added: {d}" for d in (deep or {}).get("dropped", [])]]) + "\n", encoding="utf-8")
            agent.set_output("created", "sweep")
        else:
            agent.set_output("created", "false")
        return 0

    # 2. Rewrite the paper from the register
    review["edition"] = int(review.get("edition", 0)) + 1
    if fixture is not None:
        paper = fixture["write"]["result"]
    else:
        paper, _, more = agent.run_claude(
            write_prompt(date, review, [s["id"] for s in new]), system=WRITE_SYSTEM, schema=WRITE_SCHEMA, tools=[])
        usage = agent.add_usage(usage, more)
    removed = clean_citations(paper, studies)
    flagged = uncited(paper)

    change = {"date": date.isoformat(), "edition": review["edition"],
              "text": str(paper.get("what_changed", "")).strip(), "added": [s["id"] for s in new]}
    review.update({
        "title": str(paper.get("title", "")).strip() or "AI vs Physician: how AI is changing what physicians can do",
        "updated": date.isoformat(),
        "summary": paper["summary"],
        "key_findings": paper["key_findings"],
        "sections": paper["sections"],
        "open_questions": paper["open_questions"],
        "changes": [change, *review.get("changes", [])],
        "studies": studies,
        "generated_by": agent.MODEL,
    })
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote edition {review['edition']}: {len(studies)} studies ({len(new)} new), "
          f"{len(review['sections'])} sections.")
    if usage is not None:
        print(f"Usage: {usage} (about ${agent.estimate_cost(usage):.2f})")

    # The edition's Instagram carousel (social/review-<date>/), reviewed in
    # the same pull request and posted when it is merged
    try:
        import instagram
        slides = instagram.build_review(review, ROOT / "social" / f"review-{date.isoformat()}")
        print(f"Wrote {len(slides)} Instagram slides to social/review-{date.isoformat()}/")
    except ImportError as err:
        print(f"No Instagram slides ({err}).")

    if args.pr_body:
        write_pr_body(args.pr_body, review, new, dropped, removed, flagged, note, usage, deep)
    agent.set_output("created", "true")
    agent.set_output("edition", str(review["edition"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

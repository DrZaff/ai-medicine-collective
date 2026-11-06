"""Deep sweep for "AI vs Physician": find the landmark studies.

The monthly job (living_review.py) adds about ten studies found by web search.
This job, started by hand, searches the literature itself and proposes the
studies the paper should be built on. It publishes nothing: it writes a ranked
shortlist for the editors to approve.

  1. List    ask PubMed (and Europe PMC, for preprints such as medRxiv) for every
             paper since a start date that mentions AI, clinicians and a
             comparison, and NIH iCite for each paper's citations. Free, no AI.
             High-impact papers (top journals, or highly cited for their age)
             are screened first, most cited first; then the rest, newest first.
  2. Screen  Claude reads the abstracts in batches and keeps only real
             comparisons of AI with clinicians (the same bar as the monthly
             job), recording each from its abstract and grading it: design,
             setting (real patients, real records, written cases or images) and
             reach (a task found across medicine, or one specialty). Title,
             journal, date and link come from PubMed, not from Claude.
  3. Sort    each study goes in one group (owner's decision, 2026-11-06: the
             paper is about clinical decisions):
               clinical   diagnosis, imaging, management, procedures, and AI
                          answering patients' medical questions
               workflow   documentation, scribes, coding, inbox drafts, consent
                          and patient-education material (appendix)
               education  trials with students only, or about teaching (appendix)
               excluded   published before the start date, or marked by an
                          editor with "excluded": "<reason>" in the file
  4. Rank    each study gets a landmark score from its design, setting, journal,
             citations and number of clinicians. The landmark studies come
             from the clinical group only. The result is
             evidence/deep-sweep-<date>.json, and the pull request lists them.

Nothing on the site reads the shortlist. Once the editors approve it, the
landmark studies are checked against their full text and the paper is
rewritten from them, with the rest in an appendix.

Spending is capped (--budget, default $30); screening stops before the cap,
and the pull request says how far it reached.

Usage:
    python scripts/blog_agent/deep_sweep.py --dry-run              # list and count only, no AI
    python scripts/blog_agent/deep_sweep.py [--budget 30] [--since 2023-01-01] [--pr-body PATH]
    python scripts/blog_agent/deep_sweep.py --rerank evidence/deep-sweep-<date>.json [--pr-body PATH]
        # sort and rank a saved shortlist again (after a change to the ranking,
        # or after an editor marks a study excluded); no AI, no searching

Needs ANTHROPIC_API_KEY (a GitHub Actions secret in CI). PubMed, Europe PMC
and iCite need no key.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402
import living_review as lr  # noqa: E402

BATCH = 25            # abstracts per screening request
WORKERS = 4           # screening requests in flight at once
SAFETY_MARGIN = 1.0   # dollars kept below the cap
MAX_CANDIDATES = 12000

AI_TERMS = ('"artificial intelligence" OR "large language model*" OR LLM* OR ChatGPT OR "GPT-4*" OR '
            '"deep learning" OR "machine learning" OR "neural network*" OR "computer-aided" OR '
            '"AI-assisted" OR "AI assistance"')
HUMAN_TERMS = ("physician* OR clinician* OR radiologist* OR dermatologist* OR pathologist* OR "
               "ophthalmologist* OR endoscopist* OR cardiologist* OR surgeon* OR residents OR "
               '"medical students" OR doctors OR readers OR nurses')
COMPARE_TERMS = ('versus OR "compared with" OR "compared to" OR "reader study" OR "with and without" OR '
                 'outperform* OR "non-inferior*" OR randomized OR randomised OR "head-to-head" OR '
                 '"diagnostic accuracy"')


def pubmed_query() -> str:
    tiab = lambda terms: "(" + " OR ".join(f"{t.strip()}[tiab]" for t in terms.split(" OR ")) + ")"
    return (f"{tiab(AI_TERMS)} AND {tiab(HUMAN_TERMS)} AND {tiab(COMPARE_TERMS)} NOT "
            '(review[pt] OR "systematic review"[pt] OR "meta-analysis"[pt] OR editorial[pt] OR '
            "comment[pt] OR letter[pt] OR news[pt])")


def get(url: str, tries: int = 4) -> bytes:
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "amc-deep-sweep/1.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except Exception as err:
            # A refusal (other than "too many requests") will not change on a retry
            refused = isinstance(err, urllib.error.HTTPError) and 400 <= err.code < 500 and err.code != 429
            if refused or attempt == tries - 1:
                raise
            time.sleep(2 + attempt * 3)
    return b""


# ---------------------------------------------------------------- 1. list

def pubmed_candidates(since: dt.date, until: dt.date) -> list[dict]:
    """Every PubMed match. PubMed hands out at most 10,000 records per search,
    so the search runs once per year; each result is kept on PubMed's side
    (its "history") and fetched from it page by page, as PubMed asks."""
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
    common = {"db": "pubmed", "tool": "amc-deep-sweep", "email": "noreply@aimedicinecollective.com"}
    found = []
    for year in range(since.year, until.year + 1):
        start_day = max(since, dt.date(year, 1, 1))
        end_day = min(until, dt.date(year, 12, 31))
        search = json.loads(get(base + "esearch.fcgi?" + urllib.parse.urlencode({
            **common, "term": pubmed_query(), "datetype": "pdat", "mindate": start_day.strftime("%Y/%m/%d"),
            "maxdate": end_day.strftime("%Y/%m/%d"), "retmode": "json", "retmax": 0, "usehistory": "y"})))["esearchresult"]
        total = min(int(search.get("count", 0)), 9999)
        print(f"PubMed {year}: {search.get('count')} matches, fetching {total}")
        for start in range(0, total, 200):
            xml = get(base + "efetch.fcgi?" + urllib.parse.urlencode({
                **common, "WebEnv": search["webenv"], "query_key": search["querykey"], "retstart": start,
                "retmax": 200, "rettype": "abstract", "retmode": "xml"}))
            for article in ET.fromstring(xml).iter("PubmedArticle"):
                record = parse_pubmed(article)
                if record:
                    found.append(record)
            time.sleep(0.4)  # PubMed asks for at most 3 requests a second without a key
    add_citations(found)
    return found


# The owner asked (2026-11-02) that the most cited papers in the highest-impact
# journals be screened first. Citations come from NIH iCite, which covers
# PubMed: the citation count and the Relative Citation Ratio (citations
# adjusted for field and age; 1.0 is average for an NIH-funded paper).
TOP_JOURNALS = [
    "new england journal of medicine", "nejm ai", "lancet", "jama", "bmj", "nature medicine", "nature",
    "science", "annals of internal medicine", "npj digital medicine", "radiology", "plos medicine",
    "nature communications", "journal of medical internet research", "gastroenterology", "gut",
    "european heart journal", "circulation", "journal of clinical oncology", "ophthalmology",
    "jama network open", "communications medicine", "academic medicine", "medical education",
]


def add_citations(records: list[dict]) -> None:
    by_pmid = {r["key"][5:]: r for r in records if r["key"].startswith("pmid:")}
    pmids = list(by_pmid)
    for start in range(0, len(pmids), 200):  # longer lists are refused (HTTP 413)
        chunk = pmids[start:start + 200]
        try:
            data = json.loads(get("https://icite.od.nih.gov/api/pubs?" + urllib.parse.urlencode(
                {"pmids": ",".join(chunk), "fl": "pmid,citation_count,relative_citation_ratio"})))
        except Exception as err:
            print(f"iCite unavailable for a batch ({err}); those papers are ranked by date")
            continue
        for row in data.get("data", []):
            record = by_pmid.get(str(row.get("pmid")))
            if record:
                record["citations"] = row.get("citation_count") or 0
                record["rcr"] = row.get("relative_citation_ratio") or 0.0
        time.sleep(0.3)


def top_journal(source: str) -> bool:
    name = source.lower().replace("the ", "").strip()
    return any(name == j or name.startswith(j + " ") or name.startswith(j + ":") for j in TOP_JOURNALS)


def priority(c: dict) -> tuple:
    """Screening order: high-impact papers first (a top journal, or highly
    cited for their age), most cited first; then everything else, newest first."""
    high = top_journal(c["source"]) or c.get("rcr", 0) >= 2 or c.get("citations", 0) >= 50
    if high:
        return (0, -(c.get("rcr", 0) or 0), -(c.get("citations", 0) or 0), "")
    return (1, 0, 0, "".join(chr(255 - ord(ch)) for ch in c["published"]))  # newest first


MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_pubmed(article) -> dict | None:
    cite = article.find("MedlineCitation")
    art = cite.find("Article") if cite is not None else None
    if art is None:
        return None
    pmid = cite.findtext("PMID", "").strip()
    title = "".join(art.find("ArticleTitle").itertext()).strip() if art.find("ArticleTitle") is not None else ""
    abstract = " ".join(" ".join(t.itertext()).strip() for t in art.findall("Abstract/AbstractText")).strip()
    if not (pmid and title and len(abstract) > 200):
        return None
    journal = art.findtext("Journal/Title", "").strip()
    date = None
    for node in [*art.findall("ArticleDate"), art.find("Journal/JournalIssue/PubDate")]:
        if node is None:
            continue
        year = node.findtext("Year")
        if not year:
            continue
        month = node.findtext("Month") or "1"
        month = int(month) if month.isdigit() else MONTHS.get(month[:3].lower(), 1)
        day = int(node.findtext("Day") or 1)
        try:
            date = dt.date(int(year), month, day)
            break
        except ValueError:
            continue
    doi = next((i.text for i in article.iter("ArticleId") if i.get("IdType") == "doi" and i.text), "")
    return {"key": f"pmid:{pmid}", "title": title, "abstract": abstract, "source": journal,
            "published": (date or dt.date(1900, 1, 1)).isoformat(), "doi": doi.lower(),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"}


def preprint_candidates(since: dt.date, until: dt.date, limit: int = 1500) -> list[dict]:
    """Preprints (medRxiv, arXiv, Research Square...) through Europe PMC."""
    field = lambda terms: "(" + " OR ".join(f"ABSTRACT:{t.strip()}" for t in terms.split(" OR ")) + ")"
    query = (f"{field(AI_TERMS)} AND {field(HUMAN_TERMS)} AND {field(COMPARE_TERMS)} AND SRC:PPR "
             f"AND FIRST_PDATE:[{since.isoformat()} TO {until.isoformat()}]")
    found, cursor = [], "*"
    while len(found) < limit:
        try:
            page = json.loads(get("https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode({
                "query": query, "format": "json", "resultType": "core", "pageSize": 100, "cursorMark": cursor,
                "sort": "FIRST_PDATE desc"})))
        except Exception as err:  # preprints are a supplement: keep what arrived and carry on
            print(f"Europe PMC stopped answering ({err}); keeping {len(found)} preprints")
            break
        results = page.get("resultList", {}).get("result", [])
        for r in results:
            abstract = re.sub(r"<[^>]+>", " ", r.get("abstractText") or "").strip()
            if len(abstract) < 200 or not r.get("title"):
                continue
            server = (r.get("bookOrReportDetails") or {}).get("publisher") or r.get("source", "Preprint")
            link = next((u["url"] for u in (r.get("fullTextUrlList") or {}).get("fullTextUrl", [])
                         if u.get("url", "").startswith("https://")), "") or \
                f"https://europepmc.org/article/{r.get('source', 'PPR')}/{r.get('id')}"
            found.append({"key": f"ppr:{r.get('id')}", "title": re.sub(r"<[^>]+>", "", r["title"]).strip(),
                          "abstract": abstract, "source": f"{server} (preprint, not peer reviewed)",
                          "published": r.get("firstPublicationDate", "1900-01-01"),
                          "doi": (r.get("doi") or "").lower(), "url": link})
        if not results or page.get("nextCursorMark") in (None, cursor):
            break
        cursor = page["nextCursorMark"]
        time.sleep(0.3)
    print(f"Europe PMC preprints: {len(found)}")
    return found[:limit]


def simple(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())[:80]


def fresh_candidates(candidates: list[dict], studies: list[dict]) -> list[dict]:
    """In screening order (see priority), one per paper (a preprint later
    published counts once), and nothing already in the register."""
    have = {simple(s["title"]) for s in studies} | {agent.normalize_url(s["url"]) for s in studies}
    seen, out = set(), []
    for c in sorted(candidates, key=priority):
        keys = {simple(c["title"]), c["doi"]} - {""}
        if keys & seen or simple(c["title"]) in have or agent.normalize_url(c["url"]) in have:
            continue
        seen |= keys
        out.append(c)
    return out


# ---------------------------------------------------------------- 2. screen

SCREEN_SYSTEM = lr.SEARCH_SYSTEM.split("Rules:")[0] + """\
You are given a batch of abstracts from PubMed and preprint servers. For each \
one, decide whether the study belongs in the register, judging only from the \
abstract. Most will not: AI-only benchmarks, model-development papers that \
mention clinicians only in passing, surveys of opinions, reviews and \
protocols do not qualify.

For each abstract that qualifies, fill in the record from the abstract alone:
- "finding": 2 to 3 sentences: the task, the main measure and each side's \
result, with numbers exactly as the abstract reports them. Never compute or \
round a number yourself.
- "limitation": the most important limitation visible from the abstract \
(design, setting, sample, preprint status).
- "verdict" from the study's own main result: for AI on its own against \
clinicians use ai_ahead, humans_ahead or comparable; for clinicians with \
against without AI use ai_help_improved, ai_help_no_benefit or ai_help_harmed; \
use mixed when the answer depends on the subgroup, task or measure.
- Grade the study, from the abstract:
  "design_class": rct (randomised), prospective, retrospective, cross_sectional (one-off \
reader or vignette study) or other.
  "setting": real_patients (decisions or outcomes in live care), real_records \
(real patients' records or images used retrospectively), simulated (written \
vignettes, simulated cases, exam questions) or images (a reader study on images).
  "reach": broad if the task is one that clinicians across medicine do \
(diagnostic reasoning, management, documentation, communication with patients, \
working with AI, over-reliance, training), specialty if it belongs to one \
specialty (for example reading one kind of image).
  "humans_n": how many clinicians took part, as a number, or 0 if not stated.
- If a detail is not in the abstract, leave that field empty rather than guess.
For an abstract that does not qualify, return include false and leave the \
other fields empty. Never include patient-identifiable information.
"""

SCREEN_FIELDS = ["domain", "comparison", "design", "ai_system", "humans", "finding", "limitation", "verdict"]
GRADE_FIELDS = ["design_class", "setting", "reach", "humans_n"]
DESIGNS = ["rct", "prospective", "retrospective", "cross_sectional", "other"]
SETTINGS = ["real_patients", "real_records", "simulated", "images"]


def screen_schema() -> dict:
    record = {
        "type": "object",
        "properties": {
            "ref": {"type": "string", "description": "The abstract's ref, exactly as given"},
            "include": {"type": "boolean"},
            "domain": {"type": "string", "enum": [*lr.DOMAINS, ""]},
            "comparison": {"type": "string", "enum": [*lr.COMPARISONS, ""]},
            "design": {"type": "string"},
            "ai_system": {"type": "string"},
            "humans": {"type": "string"},
            "finding": {"type": "string"},
            "limitation": {"type": "string"},
            "verdict": {"type": "string", "enum": [*lr.VERDICTS, ""]},
            "design_class": {"type": "string", "enum": [*DESIGNS, ""]},
            "setting": {"type": "string", "enum": [*SETTINGS, ""]},
            "reach": {"type": "string", "enum": ["broad", "specialty", ""]},
            "humans_n": {"type": "integer"},
        },
        "required": ["ref", "include", *SCREEN_FIELDS, *GRADE_FIELDS],
        "additionalProperties": False,
    }
    return {"type": "object", "properties": {"results": {"type": "array", "items": record}},
            "required": ["results"], "additionalProperties": False}


def screen_prompt(batch: list[dict]) -> str:
    parts = [f"ref: {i}\nTitle: {c['title']}\nSource: {c['source']}, {c['published']}\nAbstract: {c['abstract'][:4000]}"
             for i, c in enumerate(batch)]
    return ("Screen these abstracts. Return one result per ref.\n\n" + "\n\n---\n\n".join(parts))


NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def unmatched_numbers(finding: str, abstract: str) -> list[str]:
    """Numbers in the finding that do not appear in the abstract."""
    have = set(n.replace(",", "") for n in NUMBER.findall(abstract))
    return [n for n in NUMBER.findall(finding) if n.replace(",", "") not in have and len(n.replace(",", "").replace(".", "")) > 1]


def screen(candidates: list[dict], budget_for_screening: float, fake: bool = False):
    """Screen batches newest first until the money set aside runs out.
    Returns (records, usage, how many candidates were screened)."""
    batches = [candidates[i:i + BATCH] for i in range(0, len(candidates), BATCH)]
    usage = None
    records, screened, per_batch = [], 0, 0.0

    def run(batch):
        if fake:
            # Local testing only: include every fifth abstract with a placeholder record
            results = [{"ref": str(i), "include": i % 5 == 0, "domain": "diagnosis", "comparison": "ai_alone",
                        "design": "test", "ai_system": "test", "humans": "test",
                        "finding": "Test finding 12.5 vs 99.9.", "limitation": "test", "verdict": "comparable",
                        "design_class": ["rct", "retrospective"][i % 2], "setting": "simulated",
                        "reach": ["broad", "specialty"][i % 2], "humans_n": 20}
                       for i in range(len(batch))]
            return {"results": results}, {"input": 10000, "output": 1500, "cache_read": 0, "cache_write": 0, "searches": 0}
        result, _, used = agent.run_claude(screen_prompt(batch), system=SCREEN_SYSTEM, schema=screen_schema(),
                                           tools=[], effort="low")
        return result, used

    spent = 0.0
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        pending = {}
        queue = list(batches)
        while queue or pending:
            # Start another batch only if it, plus everything in flight, still fits
            while queue and len(pending) < WORKERS and spent + per_batch * (len(pending) + 1) <= budget_for_screening:
                batch = queue.pop(0)
                pending[pool.submit(run, batch)] = batch
                if per_batch == 0.0:
                    break  # learn the cost of one batch before starting more
            if not pending:
                break
            done, _ = cf.wait(pending, return_when=cf.FIRST_COMPLETED)
            for future in done:
                batch = pending.pop(future)
                try:
                    result, used = future.result()
                except BaseException as err:  # a failed batch is skipped, not fatal
                    print(f"A batch failed and was skipped: {err}")
                    continue
                usage = agent.add_usage(usage, used)
                spent = agent.estimate_cost(usage)
                screened += len(batch)
                per_batch = max(per_batch, spent / max(1, screened / BATCH))
                for row in result.get("results", []):
                    try:
                        c = batch[int(row.get("ref", -1))]
                    except (ValueError, IndexError):
                        continue
                    if not row.get("include") or row.get("verdict") not in lr.VERDICTS \
                            or row.get("comparison") not in lr.COMPARISONS or row.get("domain") not in lr.DOMAINS \
                            or not row.get("finding", "").strip():
                        continue
                    records.append({"candidate": c, "row": row})
                print(f"Screened {screened} of {len(candidates)}; kept {len(records)}; about ${spent:.2f} so far")
    return records, usage, screened


# ---------------------------------------------------------------- 3. rank

DESIGN_POINTS = {"rct": 4, "prospective": 3, "retrospective": 1, "cross_sectional": 1, "other": 0}
SETTING_POINTS = {"real_patients": 3, "real_records": 2, "images": 1, "simulated": 1}
GROUPS = ["clinical", "workflow", "education", "excluded"]
GROUP_LABELS = {"clinical": "Clinical decisions", "workflow": "Workflow (appendix)",
                "education": "Education (appendix)", "excluded": "Excluded"}

STUDENTS = re.compile(r"\bstudents?\b|undergraduate", re.I)
CLINICIANS = re.compile(r"physician|resident|doctor|clinician|surgeon|radiologist|attending|specialist|nurse|"
                        r"consultant|expert|endoscopist|dermatologist|patholog|ophthalmolog|cardiolog|sonographer|"
                        r"practitioner|psychiatrist|oncologist|neurologist|urologist|dentist", re.I)
WORKFLOW_TITLE = re.compile(r"\bcoding\b|\bcoders?\b|scribe|ambient|documentation|draft repl|portal message|"
                            r"in-basket|inbox|consent|patient education|education material|self-injection", re.I)
CLINICAL_COMMUNICATION = re.compile(r"prognos|advance care planning|mortality", re.I)


def study_group(study: dict, since: str) -> str:
    """Which group a study belongs in (see the module docstring)."""
    if study.get("excluded") or (study.get("published") or "") < since:
        return "excluded"
    humans, title, domain = study.get("humans", ""), study.get("title", ""), study.get("domain")
    if domain == "education" or (STUDENTS.search(humans) and not CLINICIANS.search(humans)):
        return "education"
    if domain == "documentation" or WORKFLOW_TITLE.search(title):
        return "workflow"
    if domain == "communication" and study.get("comparison") != "ai_alone" \
            and not CLINICAL_COMMUNICATION.search(title):
        return "workflow"  # clinicians using AI for messages or summaries, not AI answering patients
    return "clinical"


def landmark_score(study: dict) -> float:
    """How much a study should shape the paper: its design and setting, where
    it was published, how much it is cited for its age (NIH iCite RCR, on a log
    scale so a field-defining paper counts without drowning out design) and how
    many clinicians took part. The clinician count only counts when every
    number in the record was found in the abstract, because that count comes
    from the screening model."""
    score = DESIGN_POINTS.get(study.get("design_class"), 0) + SETTING_POINTS.get(study.get("setting"), 0)
    score += 2 if top_journal(study.get("source", "")) else 0
    score += min(10.0, 2 * math.log2(1 + float(study.get("rcr") or 0)))
    if not study.get("unverified_numbers"):
        n = int(study.get("humans_n") or 0)
        score += 2 if n >= 100 else 1 if n >= 20 else 0
    score -= 2 if "preprint" in study.get("source", "").lower() else 0
    return round(score, 1)


def drop_duplicates(studies: list[dict]) -> list[dict]:
    """One record per paper: a preprint and its published version share most
    of a title; keep the published one."""
    kept, seen = [], {}
    for st in sorted(studies, key=lambda s: "preprint" in s.get("source", "").lower()):
        key = simple(st["title"])[:50]
        if key in seen:
            seen[key].setdefault("also", []).append(st["url"])
            continue
        seen[key] = st
        kept.append(st)
    return kept


def rank(studies: list[dict], landmark_n: int, since: str) -> list[dict]:
    """Group, score and order the studies: the clinical group first, ranked,
    then the appendix groups, then the excluded. Landmarks come from the
    clinical group only. An editor can pin a clinical study with
    "pin": "landmark" (always a landmark, listed first) or "pin": "appendix"
    (never one); the remaining places go by score."""
    studies = drop_duplicates(studies)
    for st in studies:
        st["group"] = study_group(st, since)
        st["score"] = landmark_score(st)
        st["strength"] = strength(st)
        if st["group"] == "excluded" and not st.get("excluded"):
            st["excluded"] = f"published {st.get('published')}, before the start date {since}"
    ordered = []
    for group in GROUPS:
        members = sorted((st for st in studies if st["group"] == group),
                         key=lambda st: (-st["score"], -(st.get("citations") or 0)))
        if group == "clinical":
            pinned = [st for st in members if st.get("pin") == "landmark"]
            free = [st for st in members if st.get("pin") not in ("landmark", "appendix")]
            top = pinned + free[:max(0, landmark_n - len(pinned))]
            top.sort(key=lambda st: (-st["score"], -(st.get("citations") or 0)))
            members = top + [st for st in members if st not in top]
        for i, st in enumerate(members, 1):
            st["rank"] = i
            st["proposed_tier"] = ("landmark" if group == "clinical" and i <= landmark_n and st.get("pin") != "appendix"
                                   else "excluded" if group == "excluded" else "appendix")
        ordered += members
    return ordered


def strength(study: dict) -> str:
    """The evidence badge readers will see: strong, moderate or limited."""
    real = study.get("setting") in ("real_patients", "real_records")
    if study.get("design_class") in ("rct", "prospective") and real:
        return "strong"
    if study.get("design_class") in ("rct", "prospective") or real:
        return "moderate"
    return "limited"


def write_pr_body(path: Path, ranked: list[dict], landmark_n: int, stats: dict) -> None:
    count = lambda key, rows: ", ".join(f"{k} {n}" for k, n in sorted(
        {k: sum(1 for st in rows if st.get(key) == k) for k in {st.get(key) for st in rows}}.items(),
        key=lambda kv: -kv[1]))
    groups = {g: [st for st in ranked if st["group"] == g] for g in GROUPS}
    clinical = groups["clinical"]
    landmark_n = min(landmark_n, len(clinical))
    lines = [
        f"## AI vs Physician: deep sweep shortlist ({stats['date']})",
        "",
        f"**{len(clinical)} studies of clinical decisions; the top {landmark_n} are proposed as landmark studies.** "
        f"Workflow ({len(groups['workflow'])}) and education ({len(groups['education'])}) studies go to the "
        f"appendix; {len(groups['excluded'])} are excluded. Merging this pull request only saves the shortlist "
        f"(`evidence/deep-sweep-{stats['date']}.json`); the AI vs Physician page does not change. After approval, "
        "the landmark studies are checked against their full text and the paper is rewritten from them, with the "
        "rest in an appendix.",
        "",
        "### How far the sweep reached",
    ]
    if stats.get("listed"):
        lines += [
            f"- Candidates listed: {stats['listed']} (PubMed {stats['pubmed']}, preprints {stats['preprints']}), "
            f"{stats['fresh']} after removing duplicates and studies already in the register.",
            f"- Screened in priority order: {stats['screened']}. First the {stats['high']} high-impact candidates "
            "(top journals, or highly cited for their age by NIH iCite), most cited first; then the rest, newest "
            f"first, reaching back to {stats['reached']}.",
        ]
    else:
        lines.append(f"- Screened: {stats['screened']} candidates.")
    if stats.get("preprints") == 0:
        lines.append("- No preprints: Europe PMC did not answer during the run, so this list is PubMed only.")
    lines += [
        f"- Clinical studies by comparison: {count('comparison', clinical)}.",
        f"- Clinical studies by evidence strength: {count('strength', clinical)}.",
        "",
        "### How studies are sorted and ranked",
        "- **Groups** (owner's decision): *clinical decisions* (diagnosis, imaging, management, procedures, AI "
        "answering patients' medical questions) can be landmarks. *Workflow* (documentation, scribes, coding, "
        "inbox drafts, consent and patient-education material) and *education* (students only, or teaching) go to "
        "the appendix. Studies published before the start date, or marked by an editor, are excluded.",
        "- **Score:** design (randomised 4, prospective 3, retrospective or one-off reader/vignette study 1), "
        "setting (real patients 3, real records 2, images or written cases 1), a top journal (+2), citations for "
        "its age (2 × log2(1 + iCite RCR), up to +10), clinicians in the study (+1 for 20 or more, +2 for 100 or "
        "more; only when every number in the record was found in the abstract), and a preprint (−2).",
        "",
        f"### Proposed landmark studies (top {landmark_n})",
        "| # | Score | Study | Journal, date | Design / setting | Evidence | Cited | Verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for st in clinical[:landmark_n]:
        title = st["title"].replace("|", "/") + (" *(pinned by an editor)*" if st.get("pin") == "landmark" else "")
        lines.append(
            f"| {st['rank']} | {st['score']} | [{title}]({st['url']}) | {st['source']}, {st['published']} | "
            f"{st['design_class']} / {st['setting']} | {st['strength']} | "
            f"{st.get('citations', 0)} (RCR {float(st.get('rcr') or 0):.1f}) | "
            f"{lr.VERDICT_LABELS.get(st['verdict'], st['verdict'])} |")
    nxt = clinical[landmark_n:landmark_n + 20]
    if nxt:
        lines += ["", f"<details><summary>Next {len(nxt)} clinical studies (candidates to swap in)</summary>", ""]
        lines += [f"{st['rank']}. [{st['title']}]({st['url']}) ({st['source']}, {st['published'][:4]}; "
                  f"score {st['score']})" for st in nxt]
        lines += ["", "</details>"]
    for g in ("workflow", "education"):
        rows = groups[g]
        if rows:
            lines += ["", f"<details><summary>{GROUP_LABELS[g]}: {len(rows)} studies, top 10</summary>", ""]
            lines += [f"{st['rank']}. [{st['title']}]({st['url']}) ({st['source']}, {st['published'][:4]})"
                      for st in rows[:10]]
            lines += ["", "</details>"]
    excluded = groups["excluded"]
    if excluded:
        marked = [st for st in excluded if not st["excluded"].startswith("published ")]
        lines += ["", f"### Excluded ({len(excluded)})",
                  f"- {len(excluded) - len(marked)} were first published before {stats['since']} "
                  "(PubMed lists them by print date)."]
        lines += [f"- [{st['title']}]({st['url']}): {st['excluded']}" for st in marked]
    flagged = [st for st in ranked if st.get("unverified_numbers") and st["group"] != "excluded"]
    if flagged:
        lines += ["", f"<details><summary>Numbers not found in the abstract ({len(flagged)}); these studies get "
                  "no points for clinician count</summary>", ""]
        lines += [f"- [{st['title'][:80]}]({st['url']}): {', '.join(st['unverified_numbers'])}" for st in flagged]
        lines += ["", "</details>"]
    lines += [
        "",
        "### To approve",
        "- Tell Claude which studies to add to or drop from the landmark list (by #), or approve it as it is.",
        "- Merging saves the shortlist; it publishes nothing.",
        "",
        f"<sub>Screened by `{agent.MODEL}`: about ${stats['cost']:.2f} (cap ${stats['budget']:.0f}).</sub>",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def save(out: Path, stats: dict, ranked: list[dict]) -> None:
    out.write_text(json.dumps({"date": stats["date"], "since": stats["since"], "cost": stats["cost"],
                               "screened": stats["screened"], "stats": stats, "studies": ranked},
                              indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def rerank(path: Path, landmarks: int, pr_body: Path | None) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    stats = {"date": data["date"], "since": data["since"], "cost": data.get("cost", 0.0),
             "screened": data.get("screened", 0), "budget": 30.0, **data.get("stats", {})}
    ranked = rank(data["studies"], landmarks, stats["since"])
    save(path, stats, ranked)
    by_group = {g: sum(1 for st in ranked if st["group"] == g) for g in GROUPS}
    print(f"Ranked {path.name} again: {by_group}")
    if pr_body:
        write_pr_body(pr_body, ranked, landmarks, stats)
    return 0


# ---------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--since", type=dt.date.fromisoformat, default=dt.date(2023, 1, 1),
                        help="Oldest publication date to consider (default 2023-01-01)")
    parser.add_argument("--budget", type=float, default=30.0, help="Spending cap in US dollars (default 30)")
    parser.add_argument("--landmarks", type=int, default=40, help="How many to propose as landmark studies")
    parser.add_argument("--date", type=dt.date.fromisoformat, help="Date of the sweep (default today, US Eastern)")
    parser.add_argument("--pr-body", type=Path, help="Where to write the PR description")
    parser.add_argument("--dry-run", action="store_true", help="List and count candidates only; no AI, nothing written")
    parser.add_argument("--fake-ai", action="store_true", help="Local testing only: placeholder screening, no API")
    parser.add_argument("--rerank", type=Path, help="Sort and rank a saved shortlist again; no AI, no searching")
    args = parser.parse_args()

    if args.rerank:
        return rerank(args.rerank, args.landmarks, args.pr_body)

    date: dt.date = args.date or agent.today_eastern()
    agent.set_output("date", date.isoformat())
    studies = lr.load_review()["studies"]

    pubmed = pubmed_candidates(args.since, date)
    preprints = preprint_candidates(args.since, date)
    candidates = fresh_candidates(pubmed + preprints, studies)
    high = sum(1 for c in candidates if priority(c)[0] == 0)
    print(f"{len(candidates)} new candidates ({high} high-impact) after removing duplicates and the register's studies")
    if args.dry_run:
        words = sum(len(c["abstract"].split()) for c in candidates)
        print(f"About {words * 1.4 / 1e6:.2f} million input tokens to screen them all.")
        for c in [c for c in candidates if priority(c)[0] == 0][:15]:
            print(f"  RCR {c.get('rcr', 0) or 0:.1f}, {c.get('citations', 0)} citations: {c['source']} - {c['title'][:90]}")
        return 0

    records, usage, screened = screen(candidates, max(0.0, args.budget - SAFETY_MARGIN), fake=args.fake_ai)
    rest = [c["published"] for c in candidates[:screened] if priority(c)[0] == 1]
    reached = min(rest) if rest else "(only high-impact candidates were reached)"

    found = []
    for item in records:
        c, row = item["candidate"], item["row"]
        study = {**{k: row.get(k, "") for k in [*SCREEN_FIELDS, *GRADE_FIELDS]},
                 "title": c["title"], "url": c["url"], "source": c["source"], "published": c["published"],
                 "doi": c.get("doi", ""), "citations": c.get("citations", 0), "rcr": c.get("rcr", 0.0)}
        odd = unmatched_numbers(row.get("finding", ""), c["abstract"])
        if odd:
            study["unverified_numbers"] = odd
        found.append(study)
    if not found:
        print("Nothing qualified; nothing written.")
        agent.set_output("created", "false")
        return 0
    ranked = rank(found, args.landmarks, args.since.isoformat())

    out = agent.ROOT / "evidence" / f"deep-sweep-{date.isoformat()}.json"
    cost = agent.estimate_cost(usage) if usage else 0.0
    stats = {"date": date.isoformat(), "since": args.since.isoformat(), "cost": round(cost, 2), "high": high,
             "listed": len(pubmed) + len(preprints), "pubmed": len(pubmed), "preprints": len(preprints),
             "fresh": len(candidates), "screened": screened, "reached": reached, "budget": args.budget}
    save(out, stats, ranked)
    print(f"Wrote {out.relative_to(agent.ROOT)}: {len(ranked)} studies, about ${cost:.2f}.")
    if args.pr_body:
        write_pr_body(args.pr_body, ranked, args.landmarks, stats)
    agent.set_output("created", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())

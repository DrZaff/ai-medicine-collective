"""Check the numbers in an FAQ answer against the text of the sources it cites.

Deterministic, no AI and no network: faq_agent.py fetches each cited paper's
text (PubMed Central full text or the PubMed abstract, through NCBI's API) and
passes it here. Every number in a sentence must appear in the text of a source
that sentence cites, written the same way:

  - "X of Y", "X out of Y" and "X/Y" must appear as that pair in the source,
    so a number with the wrong denominator is not accepted;
  - a percentage must be a percentage in the source (44% is not matched by a
    bare 44), and the value must be identical (44% is not matched by 44.3%);
  - thousands separators and the Lancet's middle dot are normalised
    (80,033 = 80 033, 0.052 = 0·052), nothing else is;
  - citation markers such as [1] or [2, 3] are not numbers;
  - a four-digit year is listed but not counted as a quantitative claim.

Anything else fails closed as "unverified": a number missing from the cited
source text (even if another source has it), a sentence with a number and no
citation, a source whose text could not be fetched, a rounded or approximate
figure ("more than 80,000" for 80,033). A "found" result means only that the
same number appears in the cited text, with an excerpt for the reviewer; it
does not mean the number is used with the same meaning, comparator or
population. A person checks that.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CITATION = re.compile(r"\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]")
# A number: digits with optional thousands groups and decimals (dot or middle
# dot), optionally a percentage. Not part of a longer word or number.
NUMBER = re.compile(
    r"(?<![\w.·])(\d{1,3}(?:[,    ]\d{3})+|\d+)([.·]\d+)?(\s?%|\s?per\s?cent\b|\s?percent\b)?(?![\w·])",
    re.IGNORECASE)
# One number as NUMBER reads it (thousands groups with a comma or any kind of
# space, optional decimals), so a pair never stops at "1" in "1 200".
NUM = r"(?:\d{1,3}(?:[,    ]\d{3})+|\d+)(?:[.·]\d+)?"
PAIR = re.compile(rf"(?<![\w.·])({NUM})\s*(?:out of|of|/)\s*({NUM})(?![\w·])", re.IGNORECASE)
# The pair in source text: whole numbers on both sides, so "130 out of 32"
# does not count as "30 of 32" and "30 of 320" not as "30 of 32".
SOURCE_PAIR = r"(?<![\w.·,]){a}\s*(?:out of|of|/|in)\s*{b}(?!\d|[.·]\d)"   # a full stop may follow, a decimal may not
YEAR = re.compile(r"^(19|20)\d\d$")
# A year needs year words before it ("in 2024", "since 2019", "March 2024",
# "(2024)") AND nothing it could be counting after it: "in 2024," or
# "(2024)" is a year, "in 1980 patients" or "of 2024 patients" is a count.
YEAR_BEFORE = re.compile(
    r"(?:\b(?:in|from|since|until|till|during|between|published|"
    r"january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+|\(\s*)$", re.IGNORECASE)
YEAR_AFTER = re.compile(
    r"^(?:\s*$|\s*[,.;:)!?]|\s+(?:and|or|to|the|a|an|it|this|that|these|its|their|when|which|with|for|"
    r"on|was|were|is|are|has|had|have)\b|\s+[A-Z])")


def is_year(text: str, m: re.Match) -> bool:
    """A four-digit number written without separators, with year words before
    it and no counted noun after it. "2,024 patients", "1999 patients" and
    "a cohort of 2024 patients" are counts, checked like any other number."""
    written = m.group(1)
    if not YEAR.match(written) or m.group(2) or m.group(3):
        return False
    before = YEAR_BEFORE.search(text[max(0, m.start() - 16):m.start()])
    return bool(before and YEAR_AFTER.match(text[m.end():m.end() + 16]))


def canon(digits: str, decimals: str | None = None) -> str:
    """A number as one comparable string: no thousands separators, dot decimal."""
    whole = re.sub(r"[,    ]", "", digits)
    return whole + (("." + decimals[1:]) if decimals else "")


def numbers_in(text: str) -> list[tuple[str, bool, str]]:
    """(canonical value, is_percent, as written) for each number in the text."""
    found = []
    for m in NUMBER.finditer(text):
        found.append((canon(m.group(1), m.group(2)), bool(m.group(3)), m.group(0).strip()))
    return found


def normalise_source(text: str) -> str:
    return text.replace("·", ".")


@dataclass
class NumberResult:
    number: str            # as written in the answer
    sentence: str
    cited: list[int]       # 1-based source numbers the sentence cites
    status: str            # "found", "unverified" or "year"
    reason: str = ""
    excerpt: str = ""      # where it was found, for the reviewer
    source: int | None = None


@dataclass
class Report:
    results: list[NumberResult] = field(default_factory=list)

    @property
    def unverified(self) -> list[NumberResult]:
        return [r for r in self.results if r.status == "unverified"]

    @property
    def needs_fact_check(self) -> bool:
        return bool(self.unverified)


def _excerpt(text: str, start: int, end: int, width: int = 90) -> str:
    a, b = max(0, start - width), min(len(text), end + width)
    return ("…" if a else "") + " ".join(text[a:b].split()) + ("…" if b < len(text) else "")


def _find(value: str, percent: bool, text: str) -> re.Match | None:
    """The first place `value` appears in normalised source text, written as a
    number on its own (and as a percentage when `percent`)."""
    for m in NUMBER.finditer(text):
        if canon(m.group(1), m.group(2)) == value and bool(m.group(3)) == percent:
            return m
    return None


def _near(value: str, percent: bool, text: str) -> list[str]:
    """Numbers in the source that round to the claimed one (a hint only)."""
    try:
        target = float(value)
    except ValueError:
        return []
    hints = []
    for v, p, written in numbers_in(text):
        try:
            if p == percent and v != value and round(float(v)) == round(target) and abs(float(v) - target) < 1:
                hints.append(written)
        except ValueError:
            continue
    return hints[:3]


def check(answer: str, texts: dict[int, str]) -> Report:
    """Check every number in `answer`. `texts` maps each 1-based source number
    to its retrieved text ("" or missing when it could not be fetched)."""
    texts = {k: normalise_source(v or "") for k, v in texts.items()}
    # Source text with thousands separators removed, for the pair search
    joined = {k: re.sub(r"(?<=\d)[,    ](?=\d{3}(?!\d))", "", v) for k, v in texts.items()}
    report = Report()
    # Split at every sentence end, whatever follows (a digit, a lowercase
    # word): a sentence must carry its own citation. Splitting too often only
    # makes more numbers "unverified", never fewer.
    for sentence in re.split(r"(?<=[.!?])\s+", answer.strip()):
        cited = sorted({int(n) for marker in CITATION.findall(sentence) for n in re.findall(r"\d+", marker)})
        plain = CITATION.sub("", sentence)
        claims = [m for m in NUMBER.finditer(plain)]
        if not claims:
            continue
        # Pairs ("30 of 32") must appear as that pair in a cited source. Each
        # pair is judged on its own, by position, so a valid pair elsewhere in
        # the sentence cannot clear a failed one.
        failed_spans = []   # (start, end, "a of b") of pairs not found
        for p in PAIR.finditer(plain):
            a = canon(p.group(1).replace("·", ".").rstrip(".,"))
            b = canon(p.group(2).replace("·", ".").rstrip(".,"))
            pattern = SOURCE_PAIR.format(a=re.escape(a), b=re.escape(b))
            if not any(re.search(pattern, joined.get(n, ""), re.IGNORECASE) for n in cited):
                failed_spans.append((p.start(), p.end(), f"{a} of {b}"))
        for m in claims:
            value, percent, written = canon(m.group(1), m.group(2)), bool(m.group(3)), m.group(0).strip()
            base = dict(number=written, sentence=sentence.strip(), cited=cited)
            if is_year(plain, m) and not percent:
                report.results.append(NumberResult(**base, status="year", reason="a year, not checked"))
                continue
            if not cited:
                report.results.append(NumberResult(**base, status="unverified", reason="the sentence cites no source"))
                continue
            pair = next((label for s, e, label in failed_spans if s <= m.start() < e), None)
            if pair:
                report.results.append(NumberResult(
                    **base, status="unverified",
                    reason=f'"{pair}" does not appear as a pair in the cited source text'))
                continue
            missing = [n for n in cited if not texts.get(n)]
            hit = None
            for n in cited:
                m = _find(value, percent, texts.get(n, "")) if texts.get(n) else None
                if m:
                    hit = (n, m)
                    break
            if hit:
                n, m = hit
                report.results.append(NumberResult(**base, status="found", source=n,
                                                   excerpt=_excerpt(texts[n], m.start(), m.end())))
                continue
            if missing and len(missing) == len(cited):
                reason = "the cited source's text could not be retrieved"
            else:
                elsewhere = [k for k, t in texts.items() if k not in cited and t and _find(value, percent, t)]
                hints = [h for n in cited for h in _near(value, percent, texts.get(n, ""))]
                reason = "not found in the cited source text"
                if elsewhere:
                    reason += f"; it appears in source(s) {elsewhere}, which this sentence does not cite"
                if hints:
                    reason += f"; the cited text has {', '.join(hints)} (rounded or approximate?)"
                if missing:
                    reason += f"; source(s) {missing} could not be retrieved"
            report.results.append(NumberResult(**base, status="unverified", reason=reason))
    return report

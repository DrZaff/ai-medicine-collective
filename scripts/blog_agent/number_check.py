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
PAIR = re.compile(r"(\d[\d,.·]*)\s*(?:out of|of|/)\s*(\d[\d,.·]*)", re.IGNORECASE)
SOURCE_PAIR = r"{a}\s*(?:out of|of|/|in)\s*{b}(?![\d.·])"
YEAR = re.compile(r"^(19|20)\d\d$")


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
    report = Report()
    for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'(])", answer.strip()):
        cited = sorted({int(n) for marker in CITATION.findall(sentence) for n in re.findall(r"\d+", marker)})
        plain = CITATION.sub("", sentence)
        claims = numbers_in(plain)
        if not claims:
            continue
        # Pairs ("30 of 32") must appear as pairs in the cited source
        pairs = [(canon(a.replace("·", ".").rstrip(".,")), canon(b.replace("·", ".").rstrip(".,")))
                 for a, b in PAIR.findall(plain)]
        paired = {}
        for a, b in pairs:
            ok = None
            for n in cited:
                m = re.search(SOURCE_PAIR.format(a=re.escape(a), b=re.escape(b)),
                              re.sub(r"(?<=\d)[,   ](?=\d{3})", "", texts.get(n, "")), re.IGNORECASE)
                if m:
                    ok = n
                    break
            paired[a] = paired[b] = (ok, f"{a} of {b}")
        for value, percent, written in claims:
            base = dict(number=written, sentence=sentence.strip(), cited=cited)
            if YEAR.match(value) and not percent:
                report.results.append(NumberResult(**base, status="year", reason="a year, not checked"))
                continue
            if not cited:
                report.results.append(NumberResult(**base, status="unverified", reason="the sentence cites no source"))
                continue
            if value in paired and paired[value][0] is None:
                report.results.append(NumberResult(
                    **base, status="unverified",
                    reason=f'"{paired[value][1]}" does not appear as a pair in the cited source text'))
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

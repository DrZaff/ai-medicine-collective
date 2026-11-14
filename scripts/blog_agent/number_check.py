"""Check the numbers in an FAQ answer against the text of the sources it cites.

Deterministic, no AI and no network: faq_agent.py fetches each cited paper's
text (PubMed Central full text or the PubMed abstract, through NCBI's API) and
passes it here. Every number in a sentence must appear in the text of a source
that sentence cites, written the same way:

  - "X of Y", "X out of Y", "X in Y" and "X/Y" must appear as that pair in
    the source (any of those forms), so a wrong denominator is not accepted;
    a ratio "1:3" must appear as 1:3, in that order;
  - a percentage must be a percentage in the source (44% is not matched by a
    bare 44), and the value must be identical (44% is not matched by 44.3%);
    a range or comparison may share one % sign ("1.42 vs 1.25%", "64-100%",
    "from 5 to 10%"), so both of its numbers count as percentages;
  - a minus sign is part of the number (-5% is not 5%), but the hyphen in a
    range such as 5·4-6·9 is not a sign;
  - a magnitude word is part of the number (2.5 million is not 2.5 billion);
  - thousands separators (comma or any kind of space), the Lancet's middle
    dot and a bare leading decimal are normalised (80,033 = 80 033,
    0.052 = 0·052 = .052), nothing else is;
  - citation markers such as [1] or [2, 3] are not numbers;
  - a four-digit number is a year (listed, not counted) only with year words
    before it and only punctuation or the end after it ("In 2024,",
    "(2024)"); anything else, "in 2024 ICU patients", is checked;
  - anything the checker cannot read fails closed: scientific notation in
    any form (1.2e-5, 3×10−4, 10^-3, 10⁻⁵, p<10−5), a chain such as 1/2/3,
    or digits left over outside every number it read make every number in
    that sentence unverified; scientific notation in a source is masked, so
    none of its digits can confirm anything;
  - a ratio of any length (1:3, 1:2:3) must appear whole, in that order, in
    the cited source; a pair or ratio found there must not be part of a
    longer one ("1 of 2 of 3", "1/2/3", "3:1:2"), and a signed one ("−3 of
    10", "−1:2") must carry the same sign in the source. "10-5" in a source is read as a power of ten, but
    "10–15" (a rising range) as two numbers, unless a comparator comes
    first ("p<10-15"); a source whose superscripts were lost may still be
    misread, which a reviewer checks.

Not seen at all: numbers written as words ("forty"), units (5 mg vs 5 g),
and what a number measures; a reviewer checks those.

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
# A number: an optional sign, digits with optional thousands groups (comma or
# any kind of space) and decimals (dot or middle dot), or a leading-decimal
# number such as .05; optionally a percentage. Not part of a longer word or
# number. A minus sign counts only where it is a sign, so the hyphen in a
# range like 5·4-6·9 (a digit before it) is not read as one.
SEP = "[,    ]"
NUMBER = re.compile(
    r"(?<![\w.·])(?P<sign>[−–+-])?(?=[.·]?\d)"
    rf"(?P<int>\d{{1,3}}(?:{SEP}\d{{3}})+|\d+)?(?P<dec>[.·]\d+)?"
    r"(?P<pct>\s?%|\s?per\s?cent\b|\s?percent\b)?(?![\w·])",
    re.IGNORECASE)
# One unsigned number as NUMBER reads it, for pairs, so a pair never stops at
# "1" in "1 200" and reads ".5 of 2" whole.
NUM = rf"(?:(?:\d{{1,3}}(?:{SEP}\d{{3}})+|\d+)(?:[.·]\d+)?|[.·]\d+)"
# A minus or plus sign before the first number is part of the pair: "−3 of
# 10" must appear signed in the source.
ANSWER_SIGN = r"(?P<sign>[−–+-](?=[.·]?\d))?"
PAIR = re.compile(rf"(?<![\w.·]){ANSWER_SIGN}(?P<a>{NUM})\s*(?:out of|of|in|/)\s*(?P<b>{NUM})(?![\w·])",
                  re.IGNORECASE)
# A ratio of two or more parts, "1:3" or "1:2:3", read whole: every part must
# appear in that order, as the whole ratio, in the source.
# Three or more numbers joined by "/" or "of" ("1/2/3") are not a pair; the
# checker does not read them, so the sentence fails closed.
PAIR_CHAIN = re.compile(rf"{NUM}\s*(?:out of|of|in|/)\s*{NUM}\s*(?:out of|of|in|/)\s*{NUM}", re.IGNORECASE)
RATIO = re.compile(rf"(?<![\w.·:]){ANSWER_SIGN}(?P<terms>{NUM}(?:\s*:\s*{NUM})+)(?![\w·]|\s*:\s*\d)")
# The pair in source text: whole numbers on both sides, so "130 out of 32"
# does not count as "30 of 32" and "30 of 320" not as "30 of 32".
# Neither side may be part of a longer chain ("1/2/3") or a signed number
# ("-30 of 32"); slashes are written without spaces in the joined text.
# What surrounds the pair is checked in code (_source_has): its sign must
# match the answer's, and it may not be part of a longer number, ratio or
# chain. A chain continues with the same kind of link ("1 of 2 of 3",
# "1 in 2 in 3", "1/2/3"); "25 of 26 in 159 cases" is a pair. A full stop
# may follow, a decimal may not.
SOURCE_PAIR = r"{a}\s*(?P<sep>{sep})\s*{b}(?!\d|[.·]\d|/\d)"   # nor a fraction: "3 of 10/20"
PAIR_WORDS = "(?:out of|of|/|in)"   # "30 of 32" may be written any of these ways; a ratio "1:3" only as 1:3
# A magnitude word after a number is part of it: "2.5 million" is not "2.5 billion"
MAGNITUDE = re.compile(r"^\s*(thousand|million|billion|trillion)\b", re.IGNORECASE)
YEAR = re.compile(r"^(19|20)\d\d$")
# A year needs year words before it ("in 2024", "since 2019", "March 2024",
# "(2024)") AND nothing it could be counting after it: "in 2024," or
# "(2024)" is a year, "in 1980 patients" or "of 2024 patients" is a count.
YEAR_BEFORE = re.compile(
    r"(?:\b(?:in|from|since|until|till|during|between|published|"
    r"january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+|\(\s*)$", re.IGNORECASE)
# Only punctuation or the end may follow a year: "In 2024," or "(2024)".
# "in 2024 ICU patients" or "in 1980 and" are read as counts and checked
# (a false alarm at worst, never a missed number).
YEAR_AFTER = re.compile(r"^(?:\s*$|\s*[,.;:)!?])")
# Scientific notation in any form: 1.2e-5, 3×10−4, 3 x 10^-4, 10⁻⁵. The
# checker does not read it, so every number in such a sentence is unverified.
SCI_SIGN = r"[-+‐-―−⁺⁻]"     # any plus or minus: hyphen, dashes, superscripts
SCI_SUP = r"[⁰-⁹¹²³⁺⁻]"  # superscript digits and signs
SCIENTIFIC = re.compile(
    rf"\d\s*[eE]\s*{SCI_SIGN}?\s*\d|\d\s*[×xX*·⋅∙‧]\s*10\b|\b10\s*(?:\^|\*\*|{SCI_SUP})")
# Digits of any kind, including superscripts, for the "left over" check
ANY_DIGIT = re.compile(r"[0-9\u2070-\u2079\u00b9\u00b2\u00b3]")


def is_year(text: str, m: re.Match) -> bool:
    """A four-digit number written without separators, with year words before
    it and no counted noun after it. "2,024 patients", "1999 patients" and
    "a cohort of 2024 patients" are counts, checked like any other number."""
    written = m.group("int") or ""
    if not YEAR.match(written) or m.group("sign") or m.group("dec") or m.group("pct"):
        return False
    before = YEAR_BEFORE.search(text[max(0, m.start() - 16):m.start()])
    return bool(before and YEAR_AFTER.match(text[m.end():m.end() + 16]))


def canon(digits: str | None, decimals: str | None = None, sign: str | None = None) -> str:
    """A number as one comparable string: no thousands separators, dot
    decimal, a leading 0 before a bare decimal (.05 = 0.05), "-" for any
    minus sign ("+" is dropped)."""
    whole = re.sub(SEP, "", digits or "") or "0"
    minus = "-" if sign and sign != "+" else ""
    return minus + whole + (("." + decimals[1:]) if decimals else "")


def parts(m: re.Match) -> tuple[str, bool, str]:
    """(canonical value, is_percent, as written) for one NUMBER match."""
    return canon(m.group("int"), m.group("dec"), m.group("sign")), bool(m.group("pct")), m.group(0).strip()


def canon_token(token: str) -> str:
    """A pair's number (unsigned) in canonical form."""
    token = token.replace("·", ".").rstrip(".,")
    whole, _, dec = token.partition(".")
    return canon(whole, "." + dec if dec else None)


def numbers_in(text: str) -> list[tuple[str, bool, str]]:
    """(canonical value, is_percent, as written) for each number in the text."""
    found = []
    for m in NUMBER.finditer(text):
        found.append(parts(m))
    return found


# A whole scientific-notation expression in a source (3×10−5, 1.2e-5,
# 3 x 10^-5, 10^-3, 10⁻⁵). The checker does not read it, so it is masked
# before matching: none of its digits may confirm a number in an answer.
# An exponent written after 10: "^-5", "**(-5)", "–5", "⁻⁵", "⁺⁵"
SCI_EXP = rf"\s*(?:\^|\*\*|[eE])?\s*[({{]?\s*{SCI_SIGN}?\s*(?:\d+|{SCI_SUP}+)\s*[)}}]?"
SOURCE_SCIENTIFIC = re.compile(
    rf"\d+(?:\.\d+)?\s*(?:[eE]\s*{SCI_SIGN}?\s*\d+|[×xX*⋅∙‧]\s*10(?:{SCI_EXP})?)"
    rf"|\b10\s*(?:\^|\*\*)\s*[({{]?\s*{SCI_SIGN}?\s*\d+\s*[)}}]?"
    rf"|\b10\s*{SCI_SUP}+")
# "3·10⁻⁵" (a middle dot as the times sign, exponent written) is masked
# before middle dots become decimal points.
SOURCE_SCIENTIFIC_DOT = re.compile(
    rf"\d+(?:[.·]\d+)?\s*·\s*10\s*(?:(?:\^|\*\*)\s*[({{]?\s*{SCI_SIGN}?\s*\d+\s*[)}}]?"
    # "3·10−5": a signed exponent, but not a decimal range such as "0·10–0·15"
    rf"|[({{]?\s*{SCI_SIGN}\s*\d+(?![.·]\d)\s*[)}}]?"
    rf"|{SCI_SUP}+)")


# A bare power of ten written with a sign, "10−5" or "p<10-5". A hyphen or
# dash after 10 can also be a range ("aged 10–15"), so it counts as a power
# only when the sign is a true minus or plus, when a comparator comes before
# it, or when the second number is not larger than 10 ("10-5" is no range).
BARE_POWER = re.compile(rf"(?<![\w.·,])10\s*(?P<sign>{SCI_SIGN})\s*(?P<exp>\d+)(?![.·]?\d)")
COMPARATOR = re.compile(r"(?:[<>=≤≥]|\bp)\s*$", re.IGNORECASE)


def bare_powers(text: str) -> list[re.Match]:
    found = []
    for m in BARE_POWER.finditer(text):
        if (m.group("sign") in "+−⁺⁻" or COMPARATOR.search(text[max(0, m.start() - 6):m.start()])
                or int(m.group("exp")) <= 10):
            found.append(m)
    return found


def normalise_source(text: str) -> str:
    """Middle dots read as decimal points; scientific notation is masked."""
    text = SOURCE_SCIENTIFIC_DOT.sub(" [sci] ", text)
    text = SOURCE_SCIENTIFIC.sub(" [sci] ", text.replace("·", "."))
    for m in reversed(bare_powers(text)):
        text = text[:m.start()] + " [sci] " + text[m.end():]
    return text


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


def magnitude(text: str, end: int) -> str:
    """The magnitude word right after a number ("million"), lowercased, or ""."""
    m = MAGNITUDE.match(text[end:end + 14])
    return m.group(1).lower() if m else ""


# A range or comparison that shares one % sign: "1.42 vs 1.25%", "64-100%",
# "from 5 to 10%". Only these links; "30 patients and 10%" shares nothing.
SHARED_PERCENT_LINK = re.compile(r"\s*(?:[-–—]|to\b|vs\b\.?|versus\b)\s*", re.IGNORECASE)


def is_percent(text: str, m: re.Match) -> bool:
    """A percentage written with its own % sign, or sharing the sign of the
    percentage it is linked to by a range or comparison."""
    while not m.group("pct"):
        link = SHARED_PERCENT_LINK.match(text, m.end())
        nxt = NUMBER.match(text, link.end()) if link else None
        if not nxt:
            return False
        m = nxt
    return True


def _find(value: str, percent: bool, text: str, mag: str = "") -> re.Match | None:
    """The first place `value` appears in normalised source text, written as a
    number on its own (and as a percentage when `percent`), with the same
    magnitude word after it ("2.5 million"), if any."""
    for m in NUMBER.finditer(text):
        if parts(m)[0] == value and is_percent(text, m) == percent and magnitude(text, m.end()) == mag:
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


def answer_sign(m: re.Match) -> str:
    """"-" or "+" for a signed pair or ratio in the answer, else ""."""
    sign = m.group("sign") or ""
    return "+" if sign == "+" else "-" if sign else ""


def _source_has(pattern: str, text: str, sign: str) -> bool:
    """True if `pattern` (a pair or ratio without its left boundary) occurs in
    `text` with the same sign as the answer's and not as the tail of a longer
    number, chain or ratio."""
    for m in re.finditer(pattern, text, re.IGNORECASE):
        before = text[:m.start()]
        signed = re.search(r"[−–+-]$", before)
        found = "" if not signed else "+" if signed.group() == "+" else "-"
        if found != sign:
            continue
        rest = before[:-1] if signed else before
        if re.search(r"[\w.·,/:]$", rest):
            continue
        link = m.group("sep").lower() if "sep" in m.re.groupindex else ":"   # a ratio's link is ":"
        link = r"(?:out of|of)" if link in ("of", "out of") else re.escape(link)
        if (re.search(rf"\d\s*{link}\s*$", rest, re.IGNORECASE)
                or re.match(rf"\s*{link}\s*\d", text[m.end():], re.IGNORECASE)):
            continue
        return True
    return False


def check(answer: str, texts: dict[int, str]) -> Report:
    """Check every number in `answer`. `texts` maps each 1-based source number
    to its retrieved text ("" or missing when it could not be fetched)."""
    texts = {k: normalise_source(v or "") for k, v in texts.items()}
    # Source text with thousands separators removed, for the pair search
    # and a bare leading decimal written with its zero (.5 -> 0.5), the same
    # form canon() gives the answer's pair numbers
    joined = {k: re.sub(r"\s*/\s*", "/", re.sub(r"(?<![\w.])\.(?=\d)", "0.", re.sub(r"(?<=\d)[,    ](?=\d{3}(?!\d))", "", v)))
              for k, v in texts.items()}
    report = Report()
    # Split at every sentence end, whatever follows (a digit, a lowercase
    # word): a sentence must carry its own citation. Splitting too often only
    # makes more numbers "unverified", never fewer.
    for sentence in re.split(r"(?<=[.!?])\s+", answer.strip()):
        cited = sorted({int(n) for marker in CITATION.findall(sentence) for n in re.findall(r"\d+", marker)})
        plain = CITATION.sub("", sentence)
        claims = [m for m in NUMBER.finditer(plain)]
        if not claims and not ANY_DIGIT.search(plain):
            continue
        # Fail closed on anything the checker cannot read: scientific notation,
        # or digits left over outside every number it did read.
        covered = [False] * len(plain)
        for m in claims:
            for i in range(m.start(), m.end()):
                covered[i] = True
        leftover = "".join(c.group() for c in ANY_DIGIT.finditer(plain) if not covered[c.start()])
        unreadable = ("it uses scientific notation, which is not machine-checked"
                      if SCIENTIFIC.search(plain) or bare_powers(plain)
                      else "it chains three or more numbers with / or of" if PAIR_CHAIN.search(plain)
                      else f"it has digits the checker cannot read ({leftover})" if leftover else "")
        if unreadable:
            for item in [m.group(0).strip() for m in claims] or [leftover]:
                report.results.append(NumberResult(number=item, sentence=sentence.strip(), cited=cited,
                                                   status="unverified", reason=f"the sentence {unreadable}"))
            continue
        # Pairs ("30 of 32") must appear as that pair in a cited source. Each
        # pair is judged on its own, by position, so a valid pair elsewhere in
        # the sentence cannot clear a failed one.
        failed_spans = []   # (start, end, "a of b") of pairs not found
        for p in PAIR.finditer(plain):
            a, b, sign = canon_token(p.group("a")), canon_token(p.group("b")), answer_sign(p)
            pattern = SOURCE_PAIR.format(a=re.escape(a), b=re.escape(b), sep=PAIR_WORDS)
            if not any(_source_has(pattern, joined.get(n, ""), sign) for n in cited):
                failed_spans.append((p.start(), p.end(), f"{sign}{a} of {b}"))
        for r in RATIO.finditer(plain):
            terms = [canon_token(t) for t in re.split(r"\s*:\s*", r.group("terms"))]
            sign = answer_sign(r)
            pattern = r"\s*:\s*".join(re.escape(t) for t in terms) + r"(?!\d|\.\d|\s*:\s*\d)"
            if not any(_source_has(pattern, joined.get(n, ""), sign) for n in cited):
                failed_spans.append((r.start(), r.end(), sign + ":".join(terms)))
        for m in claims:
            value, percent, written = parts(m)
            percent = is_percent(plain, m)   # "1.42 vs 1.25%": the 1.42 is a percentage too
            mag = magnitude(plain, m.end())
            if mag:
                written = f"{written} {mag}"
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
                m = _find(value, percent, texts.get(n, ""), mag) if texts.get(n) else None
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
                elsewhere = [k for k, t in texts.items() if k not in cited and t and _find(value, percent, t, mag)]
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

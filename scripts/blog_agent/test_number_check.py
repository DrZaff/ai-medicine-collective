"""Tests for the FAQ number check (issue #185). No network, no API.

    python3 -m unittest scripts/blog_agent/test_number_check.py -v

The source texts are short excerpts of the real PubMed abstracts of MASAI
(PMID 37541274), AMIE (PMID 40205050) and Hager et al. (PMID 38965432), as
NCBI's API returns them (the Lancet's middle-dot decimals included).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import number_check  # noqa: E402

MASAI = ("80 033 women were randomly assigned to AI-supported screening (n=40 003) or double reading without AI "
         "(n=40 030). AI-supported screening among 39 996 participants resulted in 244 screen-detected cancers, "
         "861 recalls, and a total of 46 345 screen readings. Standard screening among 40 024 participants resulted "
         "in 203 screen-detected cancers. Cancer detection rates were 6·1 (95% CI 5·4-6·9) per 1000 screened "
         "participants in the intervention group and 5·1 (4·4-5·8) per 1000 in the control group-a ratio of 1·2 "
         "(95% CI 1·0-1·5; p=0·052). The screen-reading workload was reduced by 44·3% using AI.")
AMIE = ("The study included 159 case scenarios from providers in Canada, the United Kingdom and India, 20 primary "
        "care physicians compared to AMIE, and evaluations by specialist physicians and patient-actors. AMIE "
        "demonstrated greater diagnostic accuracy and superior performance on 30 out of 32 axes according to the "
        "specialist physicians and 25 out of 26 axes according to the patient-actors.")
HAGER = ("Here we have created a curated dataset based on the Medical Information Mart for Intensive Care database "
         "spanning 2,400 real patient cases and four common abdominal pathologies.")


def statuses(report):
    return {r.number: r.status for r in report.results}


class SupportedValues(unittest.TestCase):
    def test_exact_values_are_found_with_an_excerpt(self):
        r = number_check.check("MASAI screening found 244 cancers versus 203 with standard reading [1].", {1: MASAI})
        self.assertEqual(statuses(r), {"244": "found", "203": "found"})
        self.assertIn("244 screen-detected cancers", r.results[0].excerpt)
        self.assertFalse(r.needs_fact_check)

    def test_thousands_separators_and_middle_dot_are_normalised(self):
        r = number_check.check("The trial randomised 80,033 women; the ratio was 1.2 (p=0.052) [1].", {1: MASAI})
        self.assertEqual(statuses(r), {"80,033": "found", "1.2": "found", "0.052": "found"})

    def test_decimal_percentage_is_found(self):
        r = number_check.check("Workload fell by 44.3% [1].", {1: MASAI})
        self.assertEqual(statuses(r), {"44.3%": "found"})

    def test_pairs_with_their_denominators_are_found(self):
        r = number_check.check("AMIE was rated better on 30 of 32 axes by specialists and 25 of 26 by actors [2].",
                               {1: MASAI, 2: AMIE})
        self.assertEqual(set(statuses(r).values()), {"found"})


class FailsClosed(unittest.TestCase):
    def test_wrong_denominator_is_unverified(self):
        r = number_check.check("AMIE was better on 30 of 33 axes [1].", {1: AMIE})
        self.assertEqual(statuses(r), {"30": "unverified", "33": "unverified"})
        self.assertIn("pair", r.results[0].reason)

    def test_numerator_paired_with_a_different_denominator_is_unverified(self):
        # 25 and 32 both appear in the abstract, but never as "25 of 32"
        r = number_check.check("Patient actors preferred AMIE on 25 of 32 axes [1].", {1: AMIE})
        self.assertEqual(statuses(r), {"25": "unverified", "32": "unverified"})

    def test_rounded_percentage_is_unverified_with_a_hint(self):
        r = number_check.check("It cut workload by 44% [1].", {1: MASAI})
        self.assertEqual(statuses(r), {"44%": "unverified"})
        self.assertIn("44.3%", r.results[0].reason)   # shown in normalised form (the Lancet writes 44·3%)

    def test_approximate_count_is_unverified(self):
        r = number_check.check("A trial of more than 80,000 women [1].", {1: MASAI})
        self.assertEqual(statuses(r), {"80,000": "unverified"})

    def test_percent_does_not_match_a_bare_number(self):
        r = number_check.check("Agreement was 20% [1].", {1: AMIE})   # the text has 20 physicians, not 20%
        self.assertEqual(statuses(r), {"20%": "unverified"})

    def test_unavailable_source_is_unverified(self):
        r = number_check.check("WHO says 90% of tools need oversight [1].", {1: ""})
        self.assertEqual(statuses(r), {"90%": "unverified"})
        self.assertIn("could not be retrieved", r.results[0].reason)
        self.assertTrue(r.needs_fact_check)

    def test_number_only_in_another_source_is_unverified(self):
        # 2,400 is in source 2 (Hager), but the sentence cites source 1
        r = number_check.check("The models saw 2,400 patients [1].", {1: MASAI, 2: HAGER})
        self.assertEqual(statuses(r), {"2,400": "unverified"})
        self.assertIn("source(s) [2]", r.results[0].reason)

    def test_sentence_without_citation_is_unverified(self):
        r = number_check.check("About 15% of radiologists use AI.", {1: MASAI})
        self.assertEqual(statuses(r), {"15%": "unverified"})
        self.assertIn("cites no source", r.results[0].reason)


class Markers(unittest.TestCase):
    def test_citation_markers_are_not_numbers(self):
        r = number_check.check("AI screening was safe [1, 2]. It helped [3].", {1: MASAI, 2: AMIE, 3: HAGER})
        self.assertEqual(r.results, [])

    def test_year_is_listed_not_counted(self):
        r = number_check.check("In 2024, WHO guidance called for human oversight [1].", {1: ""})
        self.assertEqual(statuses(r), {"2024": "year"})
        self.assertFalse(r.needs_fact_check)
        r = number_check.check("WHO guidance (2024) calls for oversight [1].", {1: ""})
        self.assertEqual(statuses(r), {"2024": "year"})


class CodexFindings(unittest.TestCase):
    """The four problems Codex's review of b308e9f found, each reproduced."""

    def test_a_valid_pair_cannot_clear_a_failed_pair(self):
        # "25 of 32" is not in the abstract; "30 of 32" and "25 of 26" are.
        # Judged by value, the later valid pairs used to clear the failed one.
        r = number_check.check("AMIE won 25 of 32 axes, 30 of 32 with specialists and 25 of 26 with actors [1].",
                               {1: AMIE})
        first_25 = [x for x in r.results if x.number == "25"][0]
        first_32 = [x for x in r.results if x.number == "32"][0]
        self.assertEqual((first_25.status, first_32.status), ("unverified", "unverified"))
        self.assertIn('"25 of 32"', first_25.reason)
        self.assertTrue(r.needs_fact_check)

    def test_pair_numerator_must_be_a_whole_number_in_the_source(self):
        # The source also has a standalone 30 and 32, so only the pair rule can
        # catch that "30 of 32" is really "130 out of 32" (or "30 out of 320")
        src = "Readers agreed on 130 out of 32 cases. 30 readers and 32 nurses took part."
        r = number_check.check("Readers agreed on 30 of 32 cases [1].", {1: src})
        self.assertEqual(statuses(r)["30"], "unverified")
        src = "Readers agreed on 30 out of 320 cases. 32 nurses took part."
        r = number_check.check("Readers agreed on 30 of 32 cases [1].", {1: src})
        self.assertEqual(statuses(r)["32"], "unverified")

    def test_pair_with_space_separated_thousands_is_read_whole(self):
        # Codex's review of 86fc093: the pair pattern read "30 of 1 200" as
        # "30 of 1", which this source has, and "1 200" was then found on its own
        src = "Readers agreed on 30 out of 1, then 30 more. Overall 1 200 cases were read."
        for answer in ("Readers agreed on 30 of 1 200 cases [1].", "Readers agreed on 30 of 1 200 cases [1].",
                       "Readers agreed on 30 of 1,200 cases [1]."):
            r = number_check.check(answer, {1: src})
            self.assertTrue(r.needs_fact_check, answer)
            self.assertIn('"30 of 1200"', r.results[0].reason, answer)
        # a pair at the end of a source sentence is still a pair; a decimal is not
        r = number_check.check("Accuracy was 30/32 [1].", {1: "Accuracy was 30/32."})
        self.assertFalse(r.needs_fact_check)
        r = number_check.check("Accuracy was 30/32 [1].", {1: "Accuracy was 30/32.5 here; 30 and 32 appear."})
        self.assertTrue(r.needs_fact_check)
        # and the same pair written with a space is accepted when the source has it
        r = number_check.check("Readers agreed on 30 of 1 200 cases [1].", {1: "They agreed on 30 out of 1 200 cases."})
        self.assertEqual(set(statuses(r).values()), {"found"})

    def test_leading_decimal_numbers_are_checked(self):
        # Codex's review of f5e935b (blocking): ".05" was not read as a number
        r = number_check.check("The difference was significant (p<.05) [1].", {1: MASAI})
        self.assertEqual(statuses(r), {".05": "unverified"})
        self.assertTrue(r.needs_fact_check)
        r = number_check.check("The ratio's p value was .052 [1].", {1: MASAI})   # MASAI writes p=0·052
        self.assertEqual(statuses(r), {".052": "found"})

    def test_in_pairs_are_checked_as_pairs(self):
        # Codex's review of f5e935b: "30 in 32" was checked as two loose numbers
        src = "Readers agreed in 30 out of 320 cases. 32 readers took part."
        r = number_check.check("Readers agreed in 30 in 32 cases [1].", {1: src})
        self.assertTrue(r.needs_fact_check)
        self.assertIn('"30 of 32"', r.results[0].reason)

    def test_signs_are_kept_and_range_hyphens_are_not_signs(self):
        src = "Readmissions fell (change −5%). The CI was 5·4-6·9."
        r = number_check.check("Readmissions rose by 5% [1].", {1: src})
        self.assertTrue(r.needs_fact_check)          # 5% is not -5%
        r = number_check.check("Readmissions changed by −5% [1].", {1: src})
        self.assertFalse(r.needs_fact_check)
        r = number_check.check("The interval reached 6.9 [1].", {1: src})   # 6·9 after a range hyphen
        self.assertFalse(r.needs_fact_check)

    def test_ratios_must_match_in_order(self):
        # Found while fixing f5e935b: "1:3" was two loose numbers, so "3:1" passed
        r = number_check.check("Cases were randomised 1:3 [1].", {1: "Cases were randomised 3:1."})
        self.assertTrue(r.needs_fact_check)
        self.assertIn('"1:3"', r.results[0].reason)
        r = number_check.check("Cases were randomised 1:3 [1].", {1: "Cases were randomised 1:3 to the arms."})
        self.assertFalse(r.needs_fact_check)

    def test_magnitude_words_are_part_of_the_number(self):
        # Found while fixing f5e935b: "2.5 million" was matched by "2.5 billion"
        src = "The model was trained on 2.5 billion tokens."
        r = number_check.check("It was trained on 2.5 million tokens [1].", {1: src})
        self.assertTrue(r.needs_fact_check)
        self.assertEqual(r.results[0].number, "2.5 million")
        r = number_check.check("It was trained on 2.5 billion tokens [1].", {1: src})
        self.assertFalse(r.needs_fact_check)

    def test_scientific_notation_fails_closed(self):
        # Codex's review of 24d9503 (blocking): "1.2e-5" was split, and the
        # exponent 5 could match an unrelated 5 in the source
        src = "The difference was significant (p=0.003) across 5 sites."
        for answer in ("It was significant (p=1.2e-5) [1].", "It was significant (p=3×10−5) [1].",
                       "It was significant (p = 3 x 10^-5) [1].", "It was significant (p<10⁻⁵) [1]."):
            r = number_check.check(answer, {1: src})
            self.assertTrue(r.needs_fact_check, answer)
            self.assertTrue(all(x.status == "unverified" for x in r.results), answer)
            self.assertIn("scientific notation", r.results[0].reason, answer)

    def test_scientific_notation_in_a_source_confirms_nothing(self):
        # Codex's review of 09c6ee6 (blocking): source text was still split,
        # so the exponent of "3×10−5" could confirm an unrelated "5"
        for src in ("Overall p=3×10−5.", "Overall p=1.2e-5.", "Overall p = 3 x 10^-5.", "Overall p<10⁻⁵.",
                    "Overall p=10^-5.", "Overall p=3·10⁻⁵.", "Overall p=1·2×10−5.",
                    # Codex's review of ddc31cf (blocking): superscript plus;
                    # also dash minus signs and bracketed exponents
                    "Overall 3×10⁺⁵ scans.", "Overall 10⁺⁵ scans.", "Overall p=3×10–5.",
                    "Overall p=3×10‑5.", "Overall p=1.2e–5.", "Overall p=10^(−5).",
                    "Overall p=3×10^(-5).", "Overall p=3·10^(−5).",
                    # Codex's review of 0521a32 (blocking): middle dot with a
                    # plain signed exponent
                    "Overall p=3·10−5.", "Overall p=3·10-5.", "Overall p=3·10 – 5.", "Overall p=1·2·10−5.",
                    "Overall p=3‧10⁻⁵.", "Overall p=3⋅10⁻⁵.", "Overall p=3∙10−5.", "Overall p=3×10e-5."):
            for answer in ("It ran across 5 sites [1].", "It ran across 3 sites [1].",
                           "It ran across 10 sites [1]."):
                r = number_check.check(answer, {1: src})
                self.assertTrue(r.needs_fact_check, (src, answer))
                self.assertEqual(statuses(r), {answer.split()[3]: "unverified"}, (src, answer))

    def test_numbers_beside_source_scientific_notation_are_still_found(self):
        src = "It ran across 5 sites with 1·2 million scans; p=3×10−5 overall."
        r = number_check.check("It ran across 5 sites and 1.2 million scans [1].", {1: src})
        self.assertFalse(r.needs_fact_check, r.results)

    def test_middle_dot_decimal_ranges_are_still_read(self):
        # "0·10–0·15" is a range of two decimals, not 0 × 10^-0
        src = "Rates were 0·10–0·15 per 1000 and 1·10-5·20 per 100."
        r = number_check.check("Rates were 0.10 to 0.15 per 1000 and 5.20 per 100 [1].", {1: src})
        self.assertFalse(r.needs_fact_check, r.results)

    def test_bare_power_of_ten_in_a_source_confirms_nothing(self):
        # Codex's review of 0db3c67 (blocking): "10−5" was read as 10 and 5
        for src in ("Overall p<10−5.", "Overall p = 10-5.", "Overall P<10–6.", "Overall p<10 − 5.",
                    "Overall 10+5 copies.", "Overall 10-5 copies."):
            for answer in ("It ran across 5 sites [1].", "It ran across 10 sites [1].",
                           "It ran across 6 sites [1]."):
                r = number_check.check(answer, {1: src})
                self.assertTrue(r.needs_fact_check, (src, answer))
        for answer in ("It was significant (p<10−5) [1].", "It was significant (p = 10-5) [1]."):
            r = number_check.check(answer, {1: "p 10 and 5"})
            self.assertTrue(r.needs_fact_check, answer)
            self.assertIn("scientific notation", r.results[0].reason, answer)

    def test_ascending_ranges_from_ten_are_still_read(self):
        src = "Children aged 10–15 years and 10-20% of adults."
        r = number_check.check("It covered children aged 10 to 15 and 20% of adults [1].", {1: src})
        self.assertFalse(r.needs_fact_check, r.results)

    def test_ratios_of_any_length_must_appear_whole(self):
        # Codex's review of 0db3c67 (should fix): "1:2:3" was checked as 1:2
        # with the 3 matched anywhere
        r = number_check.check("Arms were allocated 1:2:3 [1].", {1: "Allocation 1:2, 3 arms."})
        self.assertTrue(r.needs_fact_check)
        self.assertEqual(set(statuses(r).values()), {"unverified"})
        self.assertFalse(number_check.check("Arms were allocated 1:2:3 [1].",
                                            {1: "Allocation was 1:2:3 overall."}).needs_fact_check)
        # A two-part ratio is not confirmed by part of a longer one
        for src in ("Allocation was 1:2:3.", "Allocation was 3:1:2."):
            self.assertTrue(number_check.check("Arms were allocated 1:2 [1].", {1: src}).needs_fact_check, src)
        # The same for "/" chains, which the checker does not read at all
        r = number_check.check("Doses were 1/2/3 mg [1].", {1: "Doses 1/2 and 3 mg."})
        self.assertTrue(r.needs_fact_check)
        self.assertIn("chains", r.results[0].reason)

    def test_source_pairs_inside_chains_or_signed_numbers_confirm_nothing(self):
        # Codex's review of c7293a1 (should fix, both)
        for src in ("Doses were 1/2/3 mg; 1 dose and 2 doses.", "Doses were 3/1/2; 1 dose and 2 doses.",
                    "Doses were 3 / 1 / 2; 1 dose and 2 doses."):
            self.assertTrue(number_check.check("Doses were 1/2 [1].", {1: src}).needs_fact_check, src)
        r = number_check.check("Scores rose on 30 of 32 axes [1].", {1: "Change was −30 of 32 axes; 30 more."})
        self.assertTrue(r.needs_fact_check)
        self.assertFalse(number_check.check("Scores rose on 30 of 32 axes [1].",
                                            {1: "Scores rose on 30 / 32 axes."}).needs_fact_check)

    def test_codex_followups_of_a11983e(self):
        # 1. a source pair inside a chain joined by "of", "in" or "out of"
        for src in ("Arms 1 of 2 of 3; 2 and 3.", "Arms 2 of 3 of 4; 2 and 3.", "Arms 1 in 2 in 3; 2 and 3.",
                    "Arms 1 out of 2 out of 3; 2 and 3."):
            self.assertTrue(number_check.check("It was 2 of 3 [1].", {1: src}).needs_fact_check, src)
        # 2. a source ratio after a minus sign
        r = number_check.check("The ratio was 1:2 [1].", {1: "The ratio was −1:2; 1 and 2 arms."})
        self.assertTrue(r.needs_fact_check)
        for src in ("The ratio was 3 : 1:2; 1 and 2 arms.", "The ratio was 1:2 : 3; 1 and 2 arms."):
            self.assertTrue(number_check.check("The ratio was 1:2 [1].", {1: src}).needs_fact_check, src)
        # 3. a signed answer pair or ratio must appear signed in the source
        for answer, src in (("It changed by −3 of 10 [1].", "It changed by 3 of 10; −3 overall."),
                            ("It changed by -3 of 10 [1].", "It changed by 3 of 10; -3 overall."),
                            ("The ratio was −1:2 [1].", "The ratio was 1:2; −1 overall.")):
            self.assertTrue(number_check.check(answer, {1: src}).needs_fact_check, answer)
        for answer, src in (("It changed by −3 of 10 [1].", "It changed by −3 of 10."),
                            ("It changed by -3 of 10 [1].", "It changed by −3 of 10."),
                            ("The ratio was −1:2 [1].", "The ratio was -1:2.")):
            self.assertFalse(number_check.check(answer, {1: src}).needs_fact_check, (answer, src))

    def test_ordinary_pairs_still_match_after_the_followups(self):
        src = "AMIE was better on 30 out of 32 axes in 2024, and 25 of 26 in 159 cases; allocation 1:2."
        r = number_check.check("AMIE was better on 30 of 32 axes, 25 out of 26, with allocation 1:2 [1].", {1: src})
        self.assertFalse(r.needs_fact_check, r.results)

    def test_unreadable_leftover_digits_fail_closed(self):
        r = number_check.check("The effect was 2³ times larger [1].", {1: "2 times larger"})
        self.assertTrue(r.needs_fact_check)

    def test_counts_before_capitalised_words_are_checked(self):
        # Codex's review of 24d9503: "in 2024 ICU patients" was exempted as a year
        for answer in ("It was tested in 2024 ICU patients [1].", "It was tested in 1980 and 2,000 controls [1]."):
            r = number_check.check(answer, {1: MASAI})
            self.assertNotIn("year", [x.status for x in r.results], answer)
            self.assertTrue(r.needs_fact_check, answer)

    def test_leading_decimal_pairs_match_the_same_pair_in_the_source(self):
        # Codex's review of 24d9503: ".5 of 2" in both places was rejected
        r = number_check.check("It won .5 of 2 points [1].", {1: "It won .5 of 2 points."})
        self.assertFalse(r.needs_fact_check)
        r = number_check.check("It won .5 of 2 points [1].", {1: "It won 0·5 of 2 points."})
        self.assertFalse(r.needs_fact_check)
        r = number_check.check("It won .5 of 3 points [1].", {1: "It won .5 of 2 points; 3 also appears."})
        self.assertTrue(r.needs_fact_check)

    def test_next_sentence_citation_does_not_cover_an_uncited_sentence(self):
        # Sentences starting with a digit or a lowercase word used not to split
        r = number_check.check("AMIE won on 30 axes. 25 out of 26 axes favoured it too [1].", {1: AMIE})
        self.assertEqual([x.status for x in r.results if x.number == "30"], ["unverified"])
        r = number_check.check("AMIE won on 30 axes. and 25 out of 26 favoured it [1].", {1: AMIE})
        self.assertEqual([x.status for x in r.results if x.number == "30"], ["unverified"])

    def test_counts_that_look_like_years_are_checked(self):
        for answer in ("The trial enrolled 2,024 patients [1].", "A cohort of 2024 patients [1].",
                       "It was tested in 1980 patients [1].", "Researchers recruited 1999 patients [1]."):
            r = number_check.check(answer, {1: MASAI})
            self.assertEqual([x.status for x in r.results], ["unverified"], answer)

    def test_number_found_in_one_of_two_cited_sources(self):
        r = number_check.check("Datasets of 2,400 cases exist [1, 2].", {1: MASAI, 2: HAGER})
        self.assertEqual(statuses(r), {"2,400": "found"})
        self.assertEqual(r.results[0].source, 2)


class AgentFixtures(unittest.TestCase):
    """faq_agent.py end to end with --fixture, on copies of the faq files."""

    def run_agent(self, fixture: dict):
        import faq_agent
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            for name in ("faq.json", "targets.json"):
                (tmp / name).write_bytes((faq_agent.FAQ_PATH.parent / name).read_bytes())
            fx, body, warn, out = tmp / "fx.json", tmp / "body.md", tmp / "warn.txt", tmp / "out.txt"
            fx.write_text(json.dumps(fixture), encoding="utf-8")
            old = faq_agent.FAQ_PATH, faq_agent.TARGETS_PATH, sys.argv, os.environ.get("GITHUB_OUTPUT")
            faq_agent.FAQ_PATH, faq_agent.TARGETS_PATH = tmp / "faq.json", tmp / "targets.json"
            sys.argv = ["faq_agent.py", "--date", "2026-11-14", "--fixture", str(fx), "--pr-body", str(body),
                        "--fact-check-file", str(warn)]
            os.environ["GITHUB_OUTPUT"] = str(out)
            try:
                with redirect_stdout(StringIO()):
                    self.assertEqual(faq_agent.main(), 0)
            finally:
                faq_agent.FAQ_PATH, faq_agent.TARGETS_PATH, sys.argv = old[0], old[1], old[2]
                if old[3] is None:
                    os.environ.pop("GITHUB_OUTPUT", None)
                else:
                    os.environ["GITHUB_OUTPUT"] = old[3]
            outputs = dict(line.split("=", 1) for line in out.read_text().splitlines())
            return outputs, body.read_text(encoding="utf-8"), warn.read_text(encoding="utf-8")

    SOURCES = [
        {"title": "MASAI trial", "url": "https://pubmed.ncbi.nlm.nih.gov/37541274/", "source": "Lancet Oncol",
         "published": "2023-08-01"},
        {"title": "AMIE", "url": "https://pubmed.ncbi.nlm.nih.gov/40205050/", "source": "Nature",
         "published": "2025-04-09"},
        {"title": "WHO guidance", "url": "https://www.who.int/publications/i/item/9789240084759",
         "source": "WHO", "published": "2024"},
    ]
    TEXTS = {"https://pubmed.ncbi.nlm.nih.gov/37541274/": MASAI,
             "https://pubmed.ncbi.nlm.nih.gov/40205050/": AMIE,
             "https://www.who.int/publications/i/item/9789240084759": ""}
    FILLER = ("This is a synthetic test answer written for the number check, padded with plain words so that "
              "it reaches the usual length of an answer on the page without adding any further numbers to it "
              "at all, because only the sentences above matter for this test of the fact-check path. ")

    def result(self, answer):
        return {"question": "Synthetic test: does AI replace screening radiologists in trials?", "category": "general",
                "answer": answer, "sources": self.SOURCES, "keywords": ["test"], "note": "fixture"}

    def test_all_numbers_found_gives_a_normal_draft(self):
        answer = ("Not in trials so far [1]. MASAI found 244 versus 203 cancers and cut workload by 44.3% [1]. "
                  "AMIE won 30 out of 32 axes in simulated chats [2]. WHO asks for human oversight [3]. "
                  + self.FILLER)
        outputs, body, warn = self.run_agent({"result": self.result(answer), "search_urls": [],
                                              "source_texts": self.TEXTS})
        self.assertEqual(outputs["needs_fact_check"], "false")
        self.assertEqual(warn.strip(), "")
        self.assertTrue(body.startswith("## FAQ draft:"))
        self.assertIn("found in the text of [1] MASAI trial", body)

    def test_unverified_number_puts_the_warning_first(self):
        answer = ("Not in trials so far [1]. MASAI found 244 versus 203 cancers and cut workload by 44% [1]. "
                  "WHO says 90% of tools need oversight [3]. " + self.FILLER)
        outputs, body, warn = self.run_agent({"result": self.result(answer), "search_urls": [],
                                              "source_texts": self.TEXTS})
        self.assertEqual(outputs["needs_fact_check"], "true")
        self.assertTrue(warn.startswith("NEEDS FACT-CHECK: 2 number(s)"))
        self.assertIn("44%", warn)
        self.assertIn("90%", warn)
        self.assertIn("text unavailable", warn)
        self.assertTrue(body.startswith("> [!WARNING]\n> **NEEDS FACT-CHECK"))
        self.assertIn("**44%: UNVERIFIED**", body)

    def test_revised_answer_from_the_fixture_is_the_one_checked(self):
        bad = "MASAI cut workload by 44% [1]. " + self.FILLER
        good = "MASAI cut workload by 44.3% [1]. " + self.FILLER
        outputs, _, _ = self.run_agent({"result": self.result(bad), "revised": self.result(good),
                                        "search_urls": [], "source_texts": self.TEXTS})
        self.assertEqual(outputs["needs_fact_check"], "false")


if __name__ == "__main__":
    unittest.main()

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
        r = number_check.check("WHO guidance from 2024 calls for oversight [1].", {1: ""})
        self.assertEqual(statuses(r), {"2024": "year"})
        self.assertFalse(r.needs_fact_check)

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

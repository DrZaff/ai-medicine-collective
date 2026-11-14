"""Tests for the owner's sign-off steps in Billy's handoff. No network, no key, no GitHub.

    python3 -m unittest scripts/billy/test_handoff.py -v
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handoff  # noqa: E402

URL = 'https://github.com/DrZaff/ai-medicine-collective/pull/999'
REPORT = {'findings': [{'severity': 'note', 'file': 'docs/x.md', 'line': 3, 'confidence': 'high',
                        'problem': 'p', 'reproduce': 'r', 'fix': 'f'}],
          'summary': 'No blocking findings.', 'verdict': 'no_blocking_findings'}


class SignOff(unittest.TestCase):
    def test_links_go_straight_to_each_step_and_end_their_line(self):
        lines = handoff.sign_off(URL)
        links = [l.split()[-1] for l in lines if 'https://' in l]
        self.assertEqual(links, [URL, URL + '/files', URL])
        for line in lines:
            if 'https://' in line:
                self.assertTrue(line.endswith(URL) or line.endswith(URL + '/files'), line)

    def test_bypass_box_only_when_approved_and_checks_passed(self):
        text = ' '.join(handoff.sign_off(URL))
        for needed in ('Changes approved', 'All checks have passed',
                       'Cannot update this protected ref', 'do not tick the box',
                       'Billy never merges', "clinician's approval of this exact commit"):
            self.assertIn(needed, text)

    def test_description_uses_tab_names_not_links(self):
        text = ' '.join(handoff.sign_off())
        self.assertNotIn('https://', text)
        self.assertIn('**Files changed** tab', text)


class PullRequestBody(unittest.TestCase):
    def body(self, issue=196):
        return handoff.pr_body('a' * 40, 'b' * 40, ['docs/x.md'], REPORT, 'Commit message', issue)

    def test_sign_off_section_comes_before_the_review_report(self):
        body = self.body()
        self.assertTrue(body.startswith('Closes #196'))
        self.assertLess(body.index('## Sign off'), body.index('## Codex review report'))
        self.assertIn('1. Ready for review', body)

    def test_existing_sections_are_kept(self):
        body = self.body(issue=None)
        for heading in ('## What changed and why', '## How it was checked', '## Risks',
                        '## Sign off', '## Codex review report'):
            self.assertIn(heading, body)
        self.assertIn('Any new commit needs a fresh Codex review', body)

    def test_body_passes_billys_secret_filter(self):
        self.assertIsNone(handoff.SECRET_RE.search(self.body()))


if __name__ == '__main__':
    unittest.main()

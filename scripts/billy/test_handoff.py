"""Tests for Billy's handoff: the owner's sign-off steps and the private-repository path
(fetch bundle, review from it, record binding). No network, no key, no GitHub.

    python3 -m unittest scripts/billy/test_handoff.py -v
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
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


def write(path, text):
    with open(path, 'w') as f:
        f.write(text)


def run(cwd, *args):
    return subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                           '-c', 'init.defaultBranch=main', *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


class PrivateRepositories(unittest.TestCase):
    """The fetch step's bundle and the review step's clone from it, with real git, no network."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_only_listed_repositories(self):
        self.assertEqual(handoff.DEFAULT_REPO, 'ai-medicine-collective')
        self.assertFalse(handoff.REPOS['ai-medicine-collective'])
        self.assertTrue(handoff.REPOS['billy-mission-control'])
        self.assertEqual(handoff.check_repo('billy-mission-control'), 'billy-mission-control')
        for bad in ('other-repo', '../ai-medicine-collective', 'DrZaff/ai-medicine-collective', ''):
            with self.assertRaises(handoff.p.SafeFailure):
                handoff.check_repo(bad)

    def test_fetched_copy_must_match_and_be_fresh(self):
        sha = 'a' * 40
        meta = {'repo': 'billy-mission-control', 'source': 'claude/x', 'sha': sha,
                'fetched_at': time.time()}
        handoff.check_source_meta(meta, 'billy-mission-control', 'claude/x', sha)
        for change in ({'repo': 'ai-medicine-collective'}, {'source': 'claude/y'},
                       {'sha': 'b' * 40}, {'fetched_at': time.time() - 3700}):
            with self.assertRaises(handoff.p.SafeFailure):
                handoff.check_source_meta(dict(meta, **change), 'billy-mission-control',
                                          'claude/x', sha)

    def make_origin(self):
        origin = os.path.join(self.tmp, 'origin')
        os.makedirs(origin)
        run(origin, 'init', '--quiet')
        write(os.path.join(origin, 'a.txt'), 'main\n')
        run(origin, 'add', 'a.txt')
        run(origin, 'commit', '--quiet', '-m', 'main commit')
        base_sha = run(origin, 'rev-parse', 'HEAD')
        run(origin, 'checkout', '--quiet', '-b', 'claude/x')
        write(os.path.join(origin, 'b.txt'), 'change\n')
        run(origin, 'add', 'b.txt')
        run(origin, 'commit', '--quiet', '-m', 'the reviewed change')
        sha = run(origin, 'rev-parse', 'HEAD')
        run(origin, 'checkout', '--quiet', 'main')
        return origin, base_sha, sha

    def test_bundle_round_trip_reviews_the_exact_commit(self):
        origin, base_sha, sha = self.make_origin()
        fetched = os.path.join(self.tmp, 'fetched')
        run(self.tmp, 'clone', '--quiet', '--no-checkout', origin, fetched)  # as the fetch step
        bundle = os.path.join(self.tmp, 'x.bundle')
        handoff.bundle_commit(fetched, sha, bundle)
        review = os.path.join(self.tmp, 'review')
        os.makedirs(review)
        repo, merge_base, files, log = handoff.fetch(review, 'claude/x', sha, url=bundle,
                                                     ref=handoff.REVIEW_REF)
        self.assertEqual(merge_base, base_sha)
        self.assertEqual(files, ['b.txt'])
        self.assertIn('the reviewed change', log)
        self.assertEqual(run(repo, 'rev-parse', 'HEAD'), sha)

    def test_bundle_of_another_commit_is_refused(self):
        origin, base_sha, sha = self.make_origin()
        fetched = os.path.join(self.tmp, 'fetched')
        run(self.tmp, 'clone', '--quiet', '--no-checkout', origin, fetched)
        bundle = os.path.join(self.tmp, 'x.bundle')
        handoff.bundle_commit(fetched, sha, bundle)
        review = os.path.join(self.tmp, 'review')
        os.makedirs(review)
        with self.assertRaises(handoff.p.SafeFailure):
            handoff.fetch(review, 'claude/x', 'f' * 40, url=bundle, ref=handoff.REVIEW_REF)

    def test_publish_refuses_a_review_of_another_repository(self):
        records = os.path.join(self.tmp, 'records')
        os.makedirs(records)
        sha = 'c' * 40
        # An older record has no "repo": it counts as the default repository.
        with open(os.path.join(records, sha + '.json'), 'w') as f:
            json.dump({'sha': sha, 'source': 'claude/x', 'reviewed_at': time.time(),
                       'verdict': 'no_blocking_findings', 'findings': [], 'summary': 's'}, f)
        old = handoff.RECORDS
        handoff.RECORDS = records
        self.addCleanup(setattr, handoff, 'RECORDS', old)
        a = argparse.Namespace(repo='billy-mission-control', source='claude/x', sha=sha, issue=None)
        with self.assertRaises(handoff.p.SafeFailure) as caught:
            handoff.publish(a)
        self.assertIn('different repository', str(caught.exception))

    def test_fetch_step_is_for_private_repositories_only(self):
        a = argparse.Namespace(repo='ai-medicine-collective', source='claude/x', sha='d' * 40)
        with self.assertRaises(handoff.p.SafeFailure) as caught:
            handoff.fetch_step(a)
        self.assertIn('public', str(caught.exception))


if __name__ == '__main__':
    unittest.main()

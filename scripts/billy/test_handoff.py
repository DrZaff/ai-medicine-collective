"""Tests for Billy's handoff: the owner's sign-off steps and the private-repository path
(fetch bundle, review from it, record binding). No network, no key, no GitHub.

    python3 -m unittest scripts/billy/test_handoff.py -v
"""

import argparse
import contextlib
import io
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
PRIVATE = 'test-private'  # a stand-in private repository, listed only during tests
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
        # No listed repository is private at present, so the private path is tested with a
        # stand-in name added for each test only.
        self.addCleanup(setattr, handoff, 'REPOS', handoff.REPOS)
        handoff.REPOS = dict(handoff.REPOS, **{PRIVATE: True})

    def test_only_listed_repositories(self):
        self.assertEqual(handoff.DEFAULT_REPO, 'ai-medicine-collective')
        self.assertFalse(handoff.REPOS['ai-medicine-collective'])
        self.assertFalse(handoff.REPOS['billy-mission-control'])  # public since 2026-11-14
        self.assertEqual(handoff.check_repo('billy-mission-control'), 'billy-mission-control')
        self.assertTrue(handoff.REPOS[PRIVATE])  # the stand-in, during tests only
        for bad in ('other-repo', '../ai-medicine-collective', 'DrZaff/ai-medicine-collective', ''):
            with self.assertRaises(handoff.p.SafeFailure):
                handoff.check_repo(bad)

    def test_fetched_copy_must_match_and_be_fresh(self):
        sha = 'a' * 40
        meta = {'repo': PRIVATE, 'source': 'claude/x', 'sha': sha,
                'fetched_at': time.time()}
        handoff.check_source_meta(meta, PRIVATE, 'claude/x', sha)
        for change in ({'repo': 'ai-medicine-collective'}, {'source': 'claude/y'},
                       {'sha': 'b' * 40}, {'fetched_at': time.time() - 3700}):
            with self.assertRaises(handoff.p.SafeFailure):
                handoff.check_source_meta(dict(meta, **change), PRIVATE,
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
        a = argparse.Namespace(repo=PRIVATE, source='claude/x', sha=sha, issue=None)
        with self.assertRaises(handoff.p.SafeFailure) as caught:
            handoff.publish(a)
        self.assertIn('different repository', str(caught.exception))

    def carried(self):
        """An owner-carried bundle of main and claude/x, plus the step's folders, all temporary."""
        origin, base_sha, sha = self.make_origin()
        path = os.path.join(self.tmp, 'carried.bundle')
        run(origin, 'bundle', 'create', path, 'main', 'claude/x')
        for name in ('SOURCES', 'WORK', 'JOURNAL'):
            folder = os.path.join(self.tmp, name.lower())
            os.makedirs(folder)
            self.addCleanup(setattr, handoff, name, getattr(handoff, name))
            setattr(handoff, name, folder)
        return path, base_sha, sha

    def fetch_args(self, bundle, sha, main, repo=PRIVATE):
        return argparse.Namespace(repo=repo, source='claude/x', sha=sha, bundle=bundle, main=main)

    def test_carried_bundle_reaches_the_reviewer_unchanged(self):
        path, base_sha, sha = self.carried()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(handoff.fetch_step(self.fetch_args(path, sha, base_sha)), 0)
        self.assertIn('covers 1 changed file(s)', out.getvalue())
        self.assertIn('"Files changed"', out.getvalue())
        bundle, meta_path = handoff.source_paths(PRIVATE, sha)
        with open(meta_path) as f:
            meta = json.load(f)
        self.assertEqual((meta['main'], meta['via']), (base_sha, 'carried bundle'))
        handoff.check_source_meta(meta, PRIVATE, 'claude/x', sha)
        review = os.path.join(self.tmp, 'review')
        os.makedirs(review)
        _, merge_base, files, _ = handoff.fetch(review, 'claude/x', sha, url=bundle,
                                                ref=handoff.REVIEW_REF)
        self.assertEqual((merge_base, files), (base_sha, ['b.txt']))

    def test_crafted_main_shows_up_as_a_smaller_file_count(self):
        # Codex's review of 3f6c885 (blocking): a builder-supplied main could hide part of a
        # change. The owner now takes main from GitHub, and the printed count is a second check:
        # a bundle whose main already holds half the change reports fewer files than the PR.
        origin, base_sha, first = self.make_origin()  # claude/x: b.txt
        run(origin, 'checkout', '--quiet', 'claude/x')
        write(os.path.join(origin, 'c.txt'), 'second half\n')
        run(origin, 'add', 'c.txt')
        run(origin, 'commit', '--quiet', '-m', 'second half')
        sha = run(origin, 'rev-parse', 'HEAD')
        run(origin, 'branch', '--force', 'crafted-main', first)  # main that already has b.txt
        for name in ('SOURCES', 'WORK', 'JOURNAL'):
            folder = os.path.join(self.tmp, name.lower())
            os.makedirs(folder)
            self.addCleanup(setattr, handoff, name, getattr(handoff, name))
            setattr(handoff, name, folder)
        honest = os.path.join(self.tmp, 'honest.bundle')
        crafted = os.path.join(self.tmp, 'crafted.bundle')
        run(origin, 'bundle', 'create', honest, 'main', 'claude/x')
        run(origin, 'update-ref', 'refs/heads/main', first)
        run(origin, 'bundle', 'create', crafted, 'main', 'claude/x')
        counts = {}
        for label, path, main in (('honest', honest, base_sha), ('crafted', crafted, first)):
            with contextlib.redirect_stdout(io.StringIO()):
                handoff.fetch_step(self.fetch_args(path, sha, main))
            with open(handoff.source_paths(PRIVATE, sha)[1]) as f:
                counts[label] = json.load(f)['files']
        self.assertEqual(counts, {'honest': 2, 'crafted': 1})

    def test_carried_bundle_with_another_main_is_refused(self):
        path, base_sha, sha = self.carried()
        with self.assertRaises(handoff.p.SafeFailure) as caught:
            handoff.fetch_step(self.fetch_args(path, sha, 'e' * 40))
        self.assertIn('not the main you named', str(caught.exception))
        self.assertFalse(os.listdir(handoff.SOURCES))

    def test_carried_bundle_at_another_commit_is_refused(self):
        path, base_sha, sha = self.carried()
        with self.assertRaises(handoff.p.SafeFailure):
            handoff.fetch_step(self.fetch_args(path, 'f' * 40, base_sha))
        self.assertFalse(os.listdir(handoff.SOURCES))

    def test_carried_bundle_needs_main_and_a_private_repository(self):
        path, base_sha, sha = self.carried()
        for main in (None, '', 'abc'):
            with self.assertRaises(handoff.p.SafeFailure):
                handoff.fetch_step(self.fetch_args(path, sha, main))
        with self.assertRaises(handoff.p.SafeFailure):
            handoff.fetch_step(self.fetch_args(path, sha, base_sha, repo='ai-medicine-collective'))

    def test_authenticated_clone_takes_everything_up_front(self):
        # Codex's review of 5caa984 (blocking): a filtered clone of a private repository had to
        # download file contents at checkout, without the token.
        url = 'https://github.com/DrZaff/billy-mission-control.git'
        self.assertEqual(handoff.clone_options(url), ['--filter=blob:none'])
        self.assertEqual(handoff.clone_options(url, env={'X': '1'}), [])
        self.assertEqual(handoff.clone_options('/tmp/x.bundle'), [])

    def test_every_git_command_in_fetch_gets_the_credentials(self):
        origin, base_sha, sha = self.make_origin()
        env = dict(os.environ, BILLY_TEST_MARK='1', GIT_TERMINAL_PROMPT='0')
        seen = []
        real = handoff.git

        def recording(cwd, *args, env=None, check=True):
            seen.append((args[0], env))
            return real(cwd, *args, env=env, check=check)

        handoff.git = recording
        self.addCleanup(setattr, handoff, 'git', real)
        work = os.path.join(self.tmp, 'work')
        os.makedirs(work)
        _, merge_base, files, _ = handoff.fetch(work, 'claude/x', sha, url=origin, env=env)
        self.assertEqual((merge_base, files), (base_sha, ['b.txt']))
        self.assertGreaterEqual(len(seen), 6)
        for command, given in seen:
            self.assertIs(given, env, command)

    def test_fetch_step_is_for_private_repositories_only(self):
        a = argparse.Namespace(repo='ai-medicine-collective', source='claude/x', sha='d' * 40)
        with self.assertRaises(handoff.p.SafeFailure) as caught:
            handoff.fetch_step(a)
        self.assertIn('public', str(caught.exception))


if __name__ == '__main__':
    unittest.main()

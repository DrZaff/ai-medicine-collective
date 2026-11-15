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
import pwd
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handoff  # noqa: E402
import pr_test  # noqa: E402

p = handoff.p
ME = pwd.getpwuid(os.getuid()).pw_name
_SAVED = {}


def setUpModule():
    """Every test runs with a protected, clear control folder of its own (the stop marker is not
    set), owned by the user running the tests in place of billy-stop."""
    root = tempfile.mkdtemp()
    os.chmod(root, 0o755)
    control = Path(root) / 'control'
    control.mkdir(mode=0o755)
    for name, value in (('CONTROL', control), ('STOP_ACCOUNT', ME),
                        ('TRUSTED_UIDS', (0, os.getuid()))):
        _SAVED[name] = getattr(p, name)
        setattr(p, name, value)
    _SAVED['root'] = root


def tearDownModule():
    shutil.rmtree(_SAVED.pop('root'), ignore_errors=True)
    for name, value in _SAVED.items():
        setattr(p, name, value)

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



class StopMarker(unittest.TestCase):
    """Issue #205: while the stop marker is set, every Billy step refuses, and publish refuses
    each write to GitHub. Every doubt about the marker counts as stopped."""

    def setUp(self):
        self.control = p.CONTROL
        self.marker = self.control / 'STOP'
        self.addCleanup(self.clear)
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def clear(self):
        if self.marker.is_dir() and not self.marker.is_symlink():
            self.marker.rmdir()
        elif self.marker.exists() or self.marker.is_symlink():
            self.marker.unlink()
        os.chmod(self.control, 0o755)

    def set_marker(self, kind='file'):
        if kind == 'file':
            self.marker.write_text('')
        elif kind == 'folder':
            self.marker.mkdir()
        elif kind == 'symlink':
            target = Path(self.tmp) / 'target'
            target.write_text('')
            self.marker.symlink_to(target)
        elif kind == 'dangling':
            self.marker.symlink_to(Path(self.tmp) / 'nowhere')

    # ------------------------------------------------------------ the check itself

    def test_a_clear_protected_folder_runs(self):
        self.assertIsNone(p.stopped())
        p.require_running()

    def test_every_kind_of_marker_stops(self):
        for kind in ('file', 'folder', 'symlink', 'dangling'):
            self.set_marker(kind)
            self.assertEqual(p.stopped(), 'the stop marker is set', kind)
            with self.assertRaises(p.Stopped):
                p.require_running()
            self.clear()

    def test_a_missing_folder_stops(self):
        with mock.patch.object(p, 'CONTROL', self.control.parent / 'missing'):
            self.assertIn('missing', p.stopped())

    def test_a_folder_owned_by_someone_else_stops(self):
        with mock.patch.object(p, 'STOP_ACCOUNT', 'someone-else'):
            self.assertIn('not a folder owned by', p.stopped())

    def test_a_folder_others_can_write_stops(self):
        for mode in (0o775, 0o757, 0o777):
            os.chmod(self.control, mode)
            self.assertIn('only it can write', p.stopped(), oct(mode))
        os.chmod(self.control, 0o755)

    def test_a_symlinked_folder_stops(self):
        link = self.control.parent / 'link'
        link.symlink_to(self.control)
        self.addCleanup(link.unlink)
        with mock.patch.object(p, 'CONTROL', link):
            self.assertIsNotNone(p.stopped())

    def test_an_unprotected_parent_stops(self):
        parent = self.control.parent
        os.chmod(parent, 0o777)
        self.addCleanup(os.chmod, parent, 0o755)
        self.assertIn('above the control folder', p.stopped())
        with mock.patch.object(p, 'TRUSTED_UIDS', (12345,)):
            os.chmod(parent, 0o755)
            self.assertIn('above the control folder', p.stopped())

    def test_the_message_says_what_it_stops_and_does_not(self):
        text = p.stop_message('the stop marker is set')
        for needed in ('New review and publish steps are refused', 'work already running',
                       'cloud agents', 'GitHub Actions', 'Only the owner clears it',
                       '"The stop marker"'):
            self.assertIn(needed, text)

    def test_the_installed_defaults(self):
        self.assertEqual(_SAVED['CONTROL'], Path('/var/lib/billy-control'))
        self.assertEqual(_SAVED['STOP_ACCOUNT'], 'billy-stop')
        self.assertEqual(_SAVED['TRUSTED_UIDS'], (0,))
        self.assertEqual(p.STOP_EXIT, 3)
        self.assertTrue(issubclass(p.Stopped, p.SafeFailure))

    # ------------------------------------------------------------ every entry point refuses

    def args(self, **over):
        return argparse.Namespace(**dict(dict(repo='ai-medicine-collective', source='claude/x',
                                              sha='c' * 40, issue=None, bundle=None, main=None,
                                              codex=None), **over))

    def test_each_step_refuses_at_the_start(self):
        self.set_marker()
        minted = mock.Mock()
        with mock.patch.object(pr_test, 'mint', minted):
            for step in (handoff.review, handoff.publish, handoff.fetch_step):
                with self.assertRaises(p.Stopped, msg=step.__name__):
                    step(self.args())
        minted.assert_not_called()
        with mock.patch.object(p, 'read_private') as read_key:
            with self.assertRaises(p.Stopped):
                pr_test.mint()  # the real mint: the key is never read, whoever calls it
            read_key.assert_not_called()

    def test_preflight_and_pr_test_refuse_at_the_start(self):
        self.set_marker()
        with mock.patch.object(p, 'read_private') as read_key:
            with self.assertRaises(p.Stopped):
                p.main()
            read_key.assert_not_called()
        with mock.patch.object(sys, 'argv', ['pr_test.py', 'negative']), \
                mock.patch.object(pr_test, 'mint') as minted:
            with self.assertRaises(p.Stopped):
                pr_test.main()
            minted.assert_not_called()

    def test_scripts_exit_with_code_3_and_say_why(self):
        # Run each script as a program, with its settings pointed at the test folder (the
        # installed scripts read only the fixed server paths; nothing can redirect them).
        self.set_marker()
        here = os.path.dirname(os.path.abspath(__file__))
        swap = {"CONTROL = Path('/var/lib/billy-control')": 'CONTROL = Path(%r)' % str(self.control),
                "STOP_ACCOUNT = 'billy-stop'": 'STOP_ACCOUNT = %r' % ME,
                'TRUSTED_UIDS = (0,)': 'TRUSTED_UIDS = (0, %d)' % os.getuid()}
        copy = os.path.join(self.tmp, 'scripts')
        shutil.copytree(here, copy, ignore=shutil.ignore_patterns('__pycache__'))
        path = os.path.join(copy, 'preflight.py')
        with open(path) as f:
            text = f.read()
        for old, new in swap.items():
            self.assertIn(old, text)
            text = text.replace(old, new)
        with open(path, 'w') as f:
            f.write(text)
        for script, argv in (('preflight.py', []), ('pr_test.py', ['negative']),
                             ('handoff.py', ['publish', 'claude/x', 'c' * 40])):
            r = subprocess.run([sys.executable, os.path.join(copy, script), *argv],
                               capture_output=True, text=True, stdin=subprocess.DEVNULL)
            if script == 'handoff.py':
                # handoff refuses unattended runs before anything else; its stop exit code is
                # proved by calling its entry point below.
                self.assertIn('unattended runs are switched off', r.stderr)
                continue
            self.assertEqual(r.returncode, 3, (script, r.stderr))
            self.assertIn('STOP: Billy is stopped: the stop marker is set', r.stderr, script)

    def test_handoff_maps_a_stop_to_exit_code_3(self):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'handoff.py')) as f:
            text = f.read()
        block = text[text.index("if __name__ == '__main__':"):]
        self.assertLess(block.index('except p.Stopped'), block.index('except p.SafeFailure'))
        self.assertIn('sys.exit(p.STOP_EXIT)', block)

    # ------------------------------------------------------------ publish, mid-run

    def publish_setup(self):
        records = os.path.join(self.tmp, 'records')
        work = os.path.join(self.tmp, 'work')
        os.makedirs(records)
        os.makedirs(work)
        sha = 'c' * 40
        with open(os.path.join(records, sha + '.json'), 'w') as f:
            json.dump({'repo': 'ai-medicine-collective', 'sha': sha, 'source': 'claude/x',
                       'reviewed_at': time.time(), 'verdict': 'no_blocking_findings',
                       'findings': [], 'summary': 's'}, f)
        for name, value in (('RECORDS', records), ('WORK', work),
                            ('JOURNAL', os.path.join(self.tmp, 'journal'))):
            patcher = mock.patch.object(handoff, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.calls = []
        repo = os.path.join(self.tmp, 'repo')
        os.makedirs(repo)
        fake_fetch = mock.Mock(return_value=(repo, 'b' * 40, ['docs/x.md'], 'log'))
        fake_git = mock.Mock(return_value='A title')
        pushed = subprocess.CompletedProcess([], 0, stdout='*\trefs/heads/x\t[new branch]\n',
                                             stderr='')
        push = mock.Mock(side_effect=lambda *a, **k: (self.calls.append('push'), pushed)[1])
        api = mock.Mock(side_effect=lambda *a, **k: (self.calls.append('pr'), {
            'user': {'login': 'billy'}, 'html_url': URL, 'head': {'sha': sha}})[1])
        revoke = mock.Mock(side_effect=lambda token: self.calls.append('revoke'))
        for target, attr, value in ((handoff, 'fetch', fake_fetch), (handoff, 'git', fake_git),
                                    (handoff.subprocess, 'run', push), (p, 'api', api),
                                    (p, 'revoke', revoke)):
            patcher = mock.patch.object(target, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        return self.args(sha=sha)

    def mint_then(self, action=None):
        def fake(*args, **kw):
            self.calls.append('mint')
            if action:
                action()
            return 'billy', 'not-a-real-token'
        return fake

    def run_publish(self, a, mint):
        out = io.StringIO()
        with mock.patch.object(pr_test, 'mint', side_effect=mint), contextlib.redirect_stdout(out):
            return handoff.publish(a)

    def test_publish_runs_normally_when_clear(self):
        a = self.publish_setup()
        self.assertEqual(self.run_publish(a, self.mint_then()), 0)
        self.assertEqual(self.calls, ['mint', 'push', 'pr', 'revoke'])

    def test_marker_set_before_minting_mints_nothing(self):
        a = self.publish_setup()
        real = p.require_running
        state = {'n': 0}

        def second_check_finds_it():
            state['n'] += 1
            if state['n'] == 2:  # after the start check, before the token is minted
                self.set_marker()
            real()

        with mock.patch.object(p, 'require_running', side_effect=second_check_finds_it):
            with self.assertRaises(p.Stopped):
                self.run_publish(a, self.mint_then())
        self.assertEqual(self.calls, [])

    def test_marker_set_after_minting_pushes_nothing_and_revokes(self):
        a = self.publish_setup()
        with self.assertRaises(p.Stopped):
            self.run_publish(a, self.mint_then(self.set_marker))
        self.assertEqual(self.calls, ['mint', 'revoke'])

    def test_marker_set_after_the_push_opens_no_pr_and_names_the_branch(self):
        a = self.publish_setup()
        run = handoff.subprocess.run

        def push_then_stop(*args, **kw):
            result = run(*args, **kw)
            self.set_marker()
            return result

        with mock.patch.object(handoff.subprocess, 'run', side_effect=push_then_stop):
            with self.assertRaises(p.Stopped) as caught:
                self.run_publish(a, self.mint_then())
        self.assertEqual(self.calls, ['mint', 'push', 'revoke'])
        self.assertIn('was already pushed', str(caught.exception))
        self.assertIn('agent/', str(caught.exception))
        self.assertIn('delete the branch', str(caught.exception))

    # ------------------------------------------------------------ review and fetch, mid-run

    def test_a_review_stopped_midway_records_nothing(self):
        records = os.path.join(self.tmp, 'records')
        os.makedirs(records)
        repo = os.path.join(self.tmp, 'repo')
        os.makedirs(repo)
        report = {'verdict': 'no_blocking_findings', 'findings': [], 'summary': 's'}

        def codex_run(cmd, **kw):
            with open(cmd[cmd.index('-o') + 1], 'w') as f:
                json.dump(report, f)
            self.set_marker()  # set while Codex was reviewing
            return subprocess.CompletedProcess(cmd, 0, '', '')

        def fake_git(cwd, *args, **kw):
            return 'c' * 40 if args[:1] == ('rev-parse',) else ''

        with mock.patch.object(handoff, 'RECORDS', records), \
                mock.patch.object(handoff, 'WORK', self.tmp), \
                mock.patch.object(handoff, 'KEY_PATHS', ()), \
                mock.patch.object(handoff, 'fetch', return_value=(repo, 'b' * 40, ['x'], 'log')), \
                mock.patch.object(handoff, 'git', side_effect=fake_git), \
                mock.patch.object(handoff.subprocess, 'run', side_effect=codex_run), \
                mock.patch.object(handoff, 'journal') as journal, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(p.Stopped):
                handoff.review(self.args(codex='/bin/true'))
        self.assertEqual(os.listdir(records), [])
        journal.assert_not_called()

    def test_fetch_checks_again_before_minting(self):
        with mock.patch.dict(handoff.REPOS, {'test-private': True}), \
                mock.patch.object(handoff, 'SOURCES', self.tmp), \
                mock.patch.object(handoff, 'WORK', self.tmp), \
                mock.patch.object(pr_test, 'mint') as minted:
            real = p.require_running
            state = {'n': 0}

            def second_check_finds_it():
                state['n'] += 1
                if state['n'] == 2:
                    self.set_marker()
                real()

            with mock.patch.object(p, 'require_running', side_effect=second_check_finds_it):
                with self.assertRaises(p.Stopped):
                    handoff.fetch_step(self.args(repo='test-private'))
            minted.assert_not_called()


class InstallScript(unittest.TestCase):
    """install.sh can't run here (it needs root on the server), so check its text."""

    def setUp(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, 'install.sh')) as f:
            self.text = f.read()

    def test_creates_the_stop_account_and_a_protected_folder(self):
        self.assertIn('STOPPER=billy-stop', self.text)
        self.assertIn('CONTROL=/var/lib/billy-control', self.text)
        self.assertIn('--shell /usr/sbin/nologin "$STOPPER"', self.text)
        self.assertIn('install -d -o "$STOPPER" -g "$STOPPER" -m 755 "$CONTROL"', self.text)
        self.assertIn('is a symlink', self.text)

    def test_proves_agent_and_publisher_cannot_change_it(self):
        self.assertIn('for u in agent "$PUB"; do', self.text)
        self.assertIn('test -w "$CONTROL"', self.text)
        self.assertIn('could create a file in $CONTROL', self.text)
        self.assertLess(self.text.index('could create a file'),
                        self.text.index('echo "stop_marker_protected=yes"'))

    def test_prints_the_marker_state_and_fingerprints(self):
        self.assertIn('stop_marker=SET', self.text)
        self.assertIn('sha256sum /opt/billy/*', self.text)
        self.assertTrue(self.text.rstrip().endswith('echo "stop_marker_protected=yes"'))

    def test_shell_syntax(self):
        here = os.path.dirname(os.path.abspath(__file__))
        r = subprocess.run(['sh', '-n', os.path.join(here, 'install.sh')], capture_output=True,
                           text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Disposable PR test for Billy. Pushes only to billy-test/ branches, never main.
Merges only as a negative test that must be refused. Prints no key or token.
Install next to preflight.py in /home/agent/.local/lib/billy/ (it imports it).
Usage: pr_test.py setup | negative"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import preflight as p

TARGET = 'billy-test/protected-target'
PREFIX = 'refs/heads/billy-test/'
GIT_URL = 'https://github.com/' + p.REPO + '.git'
WORK = '/home/agent/.cache/billy-test'
FAILS = []


def report(label, passed, detail=''):
    print(('PASS: ' if passed else 'FAIL: ') + label)
    if detail:
        print('      ' + ' | '.join(l.strip() for l in detail.strip().splitlines()[-4:])[:400])
    if not passed:
        FAILS.append(label)


def message(e):
    try:
        return str(json.loads(e.read() or b'{}').get('message', ''))[:200]
    except Exception:
        return ''


def mint():
    cfg = json.loads(p.read_private(p.ROOT / 'app.json'))
    key = p.serialization.load_pem_private_key(p.read_private(p.ROOT / 'app.pem'), password=None)
    now = int(time.time())
    msg = p.enc(b'{"alg":"RS256","typ":"JWT"}') + b'.' + p.enc(json.dumps(
        {'iat': now - 60, 'exp': now + 540, 'iss': str(cfg['app_id'])}).encode())
    jwt = (msg + b'.' + p.enc(key.sign(msg, p.padding.PKCS1v15(), p.hashes.SHA256()))).decode()
    app = p.api('GET', '/app', jwt)
    inst = p.api('GET', '/repos/' + p.REPO + '/installation', jwt)
    if app['id'] != int(cfg['app_id']) or inst['id'] != int(cfg['installation_id']):
        raise p.SafeFailure('App or installation identity mismatch.')
    res = p.api('POST', '/app/installations/%d/access_tokens' % inst['id'], jwt,
                {'repositories': ['ai-medicine-collective'], 'permissions': p.PERMISSIONS})
    return app['slug'], res['token']


class Git:
    def __init__(self, base, token):
        self.base, self.token, self.repo = base, token, os.path.join(base, 'repo')
        self.env = dict(os.environ, HOME=base, GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1',
                        GIT_ASKPASS=os.path.join(base, 'askpass'), BILLY_GIT_TOKEN=token, LC_ALL='C')

    def run(self, args, check=True):
        r = subprocess.run(['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null'] + args,
                           cwd=self.repo if os.path.isdir(self.repo) else self.base,
                           env=self.env, capture_output=True, text=True)
        out = (r.stdout + r.stderr).replace(self.token, '[redacted]')
        if check and r.returncode:
            raise p.SafeFailure('git ' + args[0] + ' failed: ' + out.strip()[-300:])
        return r.returncode, out

    def push(self, refspec):
        src, _, dst = refspec.partition(':')
        if src.startswith('+') or not dst.startswith(PREFIX):
            raise p.SafeFailure('Refusing a force push or a push outside billy-test/.')
        return self.run(['push', '--porcelain', 'origin', refspec], check=False)

    def clone_at(self, branch):
        self.run(['clone', '--quiet', '--depth', '1', '--branch', branch, GIT_URL, self.repo])

    def commit(self, name, email, stamp):
        d = os.path.join(self.repo, 'billy-test')
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, stamp + '.md'), 'w') as f:
            f.write('Disposable file from a Billy app test. Do not merge.\n')
        self.run(['add', 'billy-test'])
        self.run(['-c', 'user.name=' + name, '-c', 'user.email=' + email,
                  'commit', '--quiet', '-m', 'Billy test: disposable commit ' + stamp])


def identity(slug, token):
    bot = p.api('GET', '/users/' + urllib.parse.quote(slug + '[bot]'), token)
    return slug + '[bot]', '%d+%s[bot]@users.noreply.github.com' % (bot['id'], slug)


def setup(slug, token, g):
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    _, heads = g.run(['ls-remote', '--heads', GIT_URL, TARGET])
    if heads.strip():
        print('INFO: ' + TARGET + ' already exists.')
        g.clone_at(TARGET)
    else:
        g.clone_at('main')
        rc, out = g.push('HEAD:refs/heads/' + TARGET)
        report('create disposable target branch ' + TARGET, rc == 0, '' if rc == 0 else out)
        if rc:
            return
    dev = 'billy-test/dev-' + stamp
    name, email = identity(slug, token)
    g.run(['checkout', '--quiet', '-b', dev])
    g.commit(name, email, stamp)
    rc, out = g.push('HEAD:refs/heads/' + dev)
    report('push development branch ' + dev, rc == 0, '' if rc == 0 else out)
    if rc:
        return
    pr = p.api('POST', '/repos/' + p.REPO + '/pulls', token, {
        'title': 'Billy test PR (disposable, do not merge)', 'head': dev, 'base': TARGET,
        'body': 'Opened by the Billy GitHub App to test pushing a branch and opening a pull '
                'request. It targets the disposable branch ' + TARGET + ', not main. Do not merge.'})
    report('open PR as ' + pr['user']['login'] + ': ' + pr['html_url'], pr['user']['login'] == name)


def negative(slug, token, g):
    try:
        rules = p.api('GET', '/repos/%s/rules/branches/%s' % (p.REPO, TARGET), token)
    except urllib.error.HTTPError as e:
        raise p.SafeFailure('Could not read rules for %s (HTTP %d).' % (TARGET, e.code))
    types = sorted({r['type'] for r in rules})
    print('INFO: active rules on ' + TARGET + ': ' + (', '.join(types) or 'none'))
    if 'pull_request' not in types:
        raise p.SafeFailure('No pull-request rule on the target yet; configure the test ruleset first.')
    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    name, email = identity(slug, token)
    g.clone_at(TARGET)
    g.commit(name, email, stamp)
    rc, out = g.push('HEAD:refs/heads/' + TARGET)
    report('direct push to ' + TARGET + ' is refused', rc != 0, out)
    prs = p.api('GET', '/repos/%s/pulls?state=open&base=%s'
                % (p.REPO, urllib.parse.quote(TARGET, safe='')), token)
    prs = [x for x in prs if x['user']['login'] == name]
    if not prs:
        report('find the open test PR', False)
    else:
        n = prs[0]['number']
        try:
            p.api('PUT', '/repos/%s/pulls/%d/merge' % (p.REPO, n), token, {'merge_method': 'squash'})
            report('merge of PR #%d by Billy is refused' % n, False, 'GitHub merged it.')
        except urllib.error.HTTPError as e:
            report('merge of PR #%d by Billy is refused' % n, e.code in (403, 405),
                   'HTTP %d %s' % (e.code, message(e)))
    rc, out = g.push(':refs/heads/' + TARGET)
    report('deleting ' + TARGET + ' is refused', rc != 0, out)


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    if mode not in ('setup', 'negative'):
        raise p.SafeFailure('Usage: pr_test.py setup | negative')
    os.umask(0o077)
    os.makedirs(WORK, mode=0o700, exist_ok=True)
    base = tempfile.mkdtemp(dir=WORK)
    try:
        slug, token = mint()
        try:
            with open(os.path.join(base, 'askpass'), 'w') as f:
                f.write('#!/bin/sh\ncase "$1" in Username*) echo x-access-token;; '
                        '*) printf "%s\\n" "$BILLY_GIT_TOKEN";; esac\n')
            os.chmod(os.path.join(base, 'askpass'), 0o700)
            (setup if mode == 'setup' else negative)(slug, token, Git(base, token))
        finally:
            p.revoke(token)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    if FAILS:
        raise p.SafeFailure('%d check(s) failed.' % len(FAILS))


if __name__ == '__main__':
    try:
        main()
    except p.SafeFailure as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except urllib.error.HTTPError as error:
        print('STOP: GitHub HTTP %d %s' % (error.code, message(error)), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print('STOP: ' + type(error).__name__ + '; details suppressed.', file=sys.stderr)
        sys.exit(1)

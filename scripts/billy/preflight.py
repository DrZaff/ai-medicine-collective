#!/usr/bin/env python3
"""Manual preflight. No repository code, pushes, pull requests, or merges.

Run as the publishing user (billy-pub), whose ~/.config/billy holds app.pem and app.json.
"""
import base64
import json
import os
import pwd
import stat
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(pwd.getpwuid(os.getuid()).pw_dir) / '.config' / 'billy'
REPO = 'DrZaff/ai-medicine-collective'
PERMISSIONS = {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}

class SafeFailure(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SafeFailure('Redirect refused.')

HTTP = urllib.request.build_opener(NoRedirect())

def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise SafeFailure('Configuration and key must be owned regular files with mode 0600.')
        return stream.read()

def api(method, path, credential, body=None):
    request = urllib.request.Request(
        'https://api.github.com' + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={'Authorization': 'Bearer ' + credential,
                 'Accept': 'application/vnd.github+json',
                 'Content-Type': 'application/json',
                 'X-GitHub-Api-Version': '2026-03-10'})
    with HTTP.open(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def enc(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=')

def revoke(token):
    for attempt in range(3):
        try:
            api('DELETE', '/installation/token', token)
            print('Temporary installation token revoked.')
            return
        except urllib.error.HTTPError as error:
            if error.code == 401:
                print('Temporary installation token is already invalid.')
                return
        except Exception:
            pass
        if attempt < 2:
            time.sleep(1)
    raise SafeFailure('Token revocation could not be confirmed after three attempts; expiry remains the fallback.')

def main():
    os.umask(0o077)
    cfg = json.loads(read_private(ROOT / 'app.json'))
    key = serialization.load_pem_private_key(read_private(ROOT / 'app.pem'), password=None)
    now = int(time.time())
    message = enc(b'{"alg":"RS256","typ":"JWT"}') + b'.' + enc(json.dumps(
        {'iat': now - 60, 'exp': now + 540, 'iss': str(cfg['app_id'])}).encode())
    jwt = (message + b'.' + enc(key.sign(message, padding.PKCS1v15(), hashes.SHA256()))).decode()
    app = api('GET', '/app', jwt)
    if app['id'] != int(cfg['app_id']) or app['name'] != 'Billy - AI Medicine Collective':
        raise SafeFailure('App identity mismatch.')
    if app['permissions'] != PERMISSIONS:
        raise SafeFailure('App permissions differ from the approved exact permissions.')
    installation = api('GET', '/repos/' + REPO + '/installation', jwt)
    if ((installation['id'] != int(cfg.get('installation_id', 0)))
            or installation['account']['login'] != 'DrZaff'
            or installation['repository_selection'] != 'selected'):
        raise SafeFailure('Installation identity or selected-repository scope mismatch.')
    if installation['permissions'] != PERMISSIONS:
        raise SafeFailure('Installation permissions differ from the approved exact permissions.')
    result = api('POST', '/app/installations/' + str(installation['id']) + '/access_tokens', jwt,
                 {'repositories': ['ai-medicine-collective'], 'permissions': PERMISSIONS})
    token = result['token']
    try:
        print('Temporary token expiry: ' + str(result.get('expires_at', 'not returned')))
        if result.get('permissions') != PERMISSIONS:
            raise SafeFailure('Token permissions differ from the approved exact permissions.')
        repos = api('GET', '/installation/repositories', token)
        if (repos['total_count'] != 1
                or [r['full_name'] for r in repos['repositories']] != [REPO]):
            raise SafeFailure('Temporary token repository scope mismatch.')
        print('PASS: Billy identity and temporary token permissions and repository scope verified.')
        print('Installation-wide repository exclusivity still requires confirmation in GitHub settings.')
    finally:
        revoke(token)

if __name__ == '__main__':
    try:
        main()
    except SafeFailure as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except urllib.error.HTTPError as error:
        print('STOP: GitHub HTTP ' + str(error.code) + '; response body suppressed.', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('STOP: interrupted.', file=sys.stderr)
        sys.exit(130)
    except Exception:
        print('STOP: local or network error; details suppressed to protect credentials.', file=sys.stderr)
        sys.exit(1)

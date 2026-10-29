"""Email the organizers when something on the site needs a person.

Used by the GitHub workflows (a blog draft is ready to review, the weekly
digest is ready to send, a run failed). Plain-text email through Resend.

Needs two GitHub Actions secrets, set by the owner:
    RESEND_API_KEY   a Resend key with sending access (never in the repo)
    NOTIFY_EMAIL     who to tell; several addresses separated by commas
Without them this prints a notice and exits quietly, so the workflows keep
working before the secrets exist. A failure to send is reported but never
fails the workflow: the email is a courtesy, not the job.

Usage:
    python scripts/blog_agent/notify.py --subject "..." --body-file path.txt
    python scripts/blog_agent/notify.py --subject "..." --body "..."
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

SENDER = "AI Medicine Collective site <noreply@mail.aimedicinecollective.com>"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body")
    parser.add_argument("--body-file", type=Path)
    args = parser.parse_args()

    key = os.environ.get("RESEND_API_KEY", "").strip()
    recipients = [a.strip() for a in os.environ.get("NOTIFY_EMAIL", "").split(",") if a.strip()]
    if not key or not recipients:
        print("::notice::RESEND_API_KEY or NOTIFY_EMAIL is not set; no email sent.")
        return 0

    body = args.body if args.body is not None else args.body_file.read_text(encoding="utf-8")
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps({"from": SENDER, "to": recipients, "subject": args.subject, "text": body}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "amc-notify/1.0",  # the default Python agent is refused
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            print(f"Email sent to {len(recipients)} address(es): HTTP {response.status}")
    except urllib.error.HTTPError as err:
        print(f"::warning::Email not sent: HTTP {err.code} {err.read().decode('utf-8', 'replace')[:300]}")
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"::warning::Email not sent: {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Renew the Instagram access token before it runs out.

A long-lived Instagram token lasts 60 days, and Meta lets it be renewed for
another 60 at any time once it is a day old. The weekly job
(.github/workflows/instagram-token.yml) runs this, so the token never gets
close to expiring.

What it prints is safe to show: how many days the token now has. It never
prints the token. If Meta hands back a different token, it is written to the
file given by --out (and nowhere else) for the workflow to store as the
IG_ACCESS_TOKEN secret; the workflow deletes that file straight afterwards.

Usage (in CI):
    python scripts/blog_agent/instagram_token.py --out "$RUNNER_TEMP/ig_token"
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from instagram_publish import ApiError, call  # noqa: E402


def set_output(name: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")
    print(f"{name}={value}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="Where to put a new token, if Meta issues one")
    args = parser.parse_args()

    token = os.environ.get("IG_ACCESS_TOKEN", "").strip()
    if not token:
        print("IG_ACCESS_TOKEN is not set; nothing to renew.")
        set_output("changed", "false")
        return 0

    try:
        renewed = call("GET", "refresh_access_token", {"grant_type": "ig_refresh_token", "access_token": token})
    except ApiError as err:
        print(f"::error::The Instagram token could not be renewed: {err}. If it has already expired, "
              "make a new one in the Meta app dashboard and replace the IG_ACCESS_TOKEN secret (see CLAUDE.md).")
        return 1

    new_token = str(renewed.get("access_token") or "").strip()
    days = int(renewed.get("expires_in") or 0) // 86400
    if not new_token:
        print("::error::Meta's reply had no token in it; the old one is still in use.")
        return 1

    print(f"Renewed. The token is now good for about {days} days.")
    if new_token == token:
        print("Meta extended the same token, so there is nothing new to store.")
        set_output("changed", "false")
        return 0

    args.out.write_text(new_token, encoding="utf-8")
    print("Meta issued a different token; it needs storing as the IG_ACCESS_TOKEN secret.")
    set_output("changed", "true")
    return 0


if __name__ == "__main__":
    sys.exit(main())

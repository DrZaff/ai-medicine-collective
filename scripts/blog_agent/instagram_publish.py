"""Publish a carousel from social/<name>/ to Instagram.

<name> is a blog post's date, or "digest-<date>" or "review-<date>" (see
instagram.py). For blog posts and AI vs Human editions this runs after their
pull request is merged (.github/workflows/instagram-publish.yml): the slides
were reviewed in that pull request, so merging is the approval. The weekly
digest's recap is posted by the digest job itself, since everything in it was
already approved when its blog posts were merged.

Steps, using Meta's "Instagram API with Instagram Login":
  1. wait until the slides are reachable on the live site (Instagram fetches
     them from there, so the site has to have finished updating)
  2. stop if this post is already on the account (so a re-run never posts twice)
  3. make one container per slide, one carousel container, then publish it

Needs one environment value (a GitHub Actions secret in CI):
    IG_ACCESS_TOKEN   a long-lived token for the account (lasts 60 days; see CLAUDE.md)
The account's id is looked up from the token. IG_USER_ID can be set to
override that, but is not needed.

Usage:
    python scripts/blog_agent/instagram_publish.py --name <folder under social/> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOCIAL_DIR = ROOT / "social"
SITE_URL = "https://www.aimedicinecollective.com"
API = "https://" + os.environ.get("IG_API_HOST", "graph.instagram.com")

SITE_WAIT_SECONDS = 15 * 60     # how long to wait for the site to serve the slides
CONTAINER_WAIT_SECONDS = 5 * 60


class ApiError(RuntimeError):
    pass


def call(method: str, path: str, params: dict) -> dict:
    """One request to the Instagram API. The token travels in the request
    body or query, never in anything this script prints."""
    data = urllib.parse.urlencode(params).encode()
    url = f"{API}/{path}"
    if method == "GET":
        url, data = f"{url}?{data.decode()}", None
    request = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read().decode()).get("error", {})
        except Exception:
            detail = {}
        message = detail.get("message") or f"HTTP {err.code}"
        if detail.get("code") == 190:
            message += " (the access token has expired or is wrong: make a new one, see CLAUDE.md)"
        raise ApiError(f"{method} /{path.split('/')[-1]}: {message}") from None
    except urllib.error.URLError as err:
        raise ApiError(f"{method} /{path.split('/')[-1]}: could not reach Instagram ({err.reason})") from None


def reachable(url: str) -> bool:
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "amc-instagram-publish"})
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status == 200 and "image" in response.headers.get("Content-Type", "")
    except Exception:
        return False


def wait_for_site(urls: list[str]) -> bool:
    deadline = time.time() + SITE_WAIT_SECONDS
    while True:
        missing = [u for u in urls if not reachable(u)]
        if not missing:
            return True
        if time.time() > deadline:
            print(f"Still not on the site after {SITE_WAIT_SECONDS // 60} minutes: {missing[0]}")
            return False
        print(f"Waiting for the site to update ({len(missing)} of {len(urls)} slides not there yet)...")
        time.sleep(30)


def wait_until_ready(container: str, token: str) -> None:
    deadline = time.time() + CONTAINER_WAIT_SECONDS
    while True:
        status = call("GET", container, {"fields": "status_code", "access_token": token}).get("status_code")
        if status in (None, "FINISHED", "PUBLISHED"):
            return
        if status in ("ERROR", "EXPIRED"):
            raise ApiError(f"Instagram could not process a slide (status {status})")
        if time.time() > deadline:
            raise ApiError("Instagram was still processing the slides after 5 minutes")
        time.sleep(5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", "--date", dest="name", required=True,
                        help="The folder under social/: a blog post's date, digest-<date> or review-<date>")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be posted; contact nobody")
    args = parser.parse_args()

    if not all(ch.isalnum() or ch == "-" for ch in args.name):
        print(f"Not a carousel name: {args.name}")
        return 1
    folder = SOCIAL_DIR / args.name
    slides = sorted(folder.glob("*.jpg"))
    caption_file = folder / "caption.txt"
    if len(slides) < 2 or not caption_file.exists():
        print(f"No carousel in {folder.relative_to(ROOT)} (needs at least 2 slides and caption.txt); nothing to post.")
        return 0
    if len(slides) > 10:
        print("A carousel holds at most 10 slides; nothing posted.")
        return 1
    caption = caption_file.read_text(encoding="utf-8").strip()
    urls = [f"{SITE_URL}/social/{args.name}/{slide.name}" for slide in slides]
    # A phrase that is in this caption and no other: how the post is recognised later
    marker_file = folder / "marker.txt"
    marker = marker_file.read_text(encoding="utf-8").strip() if marker_file.exists() else f"blog?date={args.name}"
    if not marker or marker not in caption:
        print("The marker is missing from the caption; nothing posted (a re-run could post twice).")
        return 1

    token = os.environ.get("IG_ACCESS_TOKEN", "").strip()
    if args.dry_run:
        print(f"Would post {len(urls)} slides:")
        for url in urls:
            print(f"  {url}  ({'on the site' if reachable(url) else 'NOT on the site yet'})")
        print(f"Caption ({len(caption)} characters):\n{caption}\n")
        if not token:
            print("::warning::IG_ACCESS_TOKEN is not set, so the account was not checked.")
            return 0
        # Reading only: who the token belongs to, and whether this post is there already
        try:
            me = call("GET", "me", {"fields": "user_id,username", "access_token": token})
            print(f"The token works. It belongs to @{me.get('username', '?')}.")
            listed = None
            for candidate in dict.fromkeys(str(me.get(key) or "") for key in ("user_id", "id")):
                if not candidate:
                    continue
                try:
                    listed = call("GET", f"{candidate}/media", {"fields": "caption", "limit": 30, "access_token": token})
                    break
                except ApiError as err:
                    print(f"(One of the account's two ids could not list posts: {err})")
            if listed is None:
                print("::error::The token could not list the account's posts; publishing would fail.")
                return 1
            already = any(marker in (media.get("caption") or "") for media in listed.get("data", []))
            print(f"The account has {len(listed.get('data', []))} recent post(s); this one is "
                  f"{'ALREADY there' if already else 'not there yet'}. Nothing was posted.")
        except ApiError as err:
            print(f"::error::The token check failed: {err}")
            return 1
        return 0

    if not token:
        print("IG_ACCESS_TOKEN is not set; nothing posted.")
        return 0

    try:
        # Whose token is this? Meta gives an account two ids; the first one
        # that can list the account's posts is the one to publish with.
        me = call("GET", "me", {"fields": "user_id,username", "access_token": token})
        candidates = [os.environ.get("IG_USER_ID", "").strip(), str(me.get("user_id") or ""), str(me.get("id") or "")]
        candidates = [c for i, c in enumerate(candidates) if c and c not in candidates[:i]]
        user = recent = None
        problem = None
        for candidate in candidates:
            try:
                recent = call("GET", f"{candidate}/media", {"fields": "caption", "limit": 30, "access_token": token})
                user = candidate
                break
            except ApiError as err:
                problem = err
        if user is None:
            raise problem or ApiError("could not work out which Instagram account the token belongs to")
        print(f"Posting as @{me.get('username', '?')}")
        if any(marker in (media.get("caption") or "") for media in recent.get("data", [])):
            print(f"The {args.name} post is already on Instagram; nothing to do.")
            return 0

        if not wait_for_site(urls):
            return 1

        children = []
        for url in urls:
            made = call("POST", f"{user}/media", {"image_url": url, "is_carousel_item": "true", "access_token": token})
            children.append(made["id"])
        for child in children:
            wait_until_ready(child, token)

        carousel = call("POST", f"{user}/media", {
            "media_type": "CAROUSEL", "children": ",".join(children), "caption": caption, "access_token": token})
        wait_until_ready(carousel["id"], token)
        published = call("POST", f"{user}/media_publish", {"creation_id": carousel["id"], "access_token": token})
    except ApiError as err:
        print(f"::error::Instagram post for {args.name} failed: {err}")
        return 1

    print(f"Posted the {args.name} carousel ({len(urls)} slides). Instagram media id: {published.get('id')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

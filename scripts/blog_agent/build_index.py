"""Build blog/index.json from blog/posts/*.json.

Runs as the Netlify build command (see netlify.toml) so the index is never
committed: each draft PR only adds its own post file, and PRs can't
conflict with each other. Standard library only.

Run it locally before previewing the blog page:
    python scripts/blog_agent/build_index.py
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POSTS_DIR = ROOT / "blog" / "posts"
INDEX_PATH = ROOT / "blog" / "index.json"


def main() -> None:
    entries = []
    for path in POSTS_DIR.glob("*.json"):
        try:
            dt.date.fromisoformat(path.stem)
            post = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, json.JSONDecodeError) as err:
            print(f"Skipping {path.name}: {err}")
            continue
        entries.append({
            "date": path.stem,
            "headline": post.get("headline", ""),
            "items": len(post.get("items", [])),
            "tags": post.get("tags", []),
        })

    entries.sort(key=lambda e: e["date"], reverse=True)
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {INDEX_PATH.relative_to(ROOT)} with {len(entries)} post(s).")


if __name__ == "__main__":
    main()

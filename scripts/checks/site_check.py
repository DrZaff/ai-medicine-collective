"""Safe, offline checks for the site. Standard library only; no secrets, no network.

Run before opening a pull request (humans and agents alike):
    python scripts/checks/site_check.py

It also runs on every pull request (.github/workflows/site-checks.yml).
It never changes tracked files: the blog index it builds is gitignored.

Checks:
  1. Every JSON data file parses (blog posts, editorial queue, evidence,
     newsletter data, the web manifest). A blog post that does not parse
     would otherwise be skipped silently by build_index.py.
  2. The Netlify build step (build_index.py) succeeds.
  3. Every JavaScript file passes a syntax check (needs Node; skipped without it).
  4. Every local link and asset in the HTML pages points to a file that exists,
     with the exact same upper/lower case (CLAUDE.md Rule 4).
  5. Every page except the forwarding pages loads script.js (CLAUDE.md).
  6. No obvious secrets in tracked files (CLAUDE.md Rule 2).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]

JSON_GLOBS = [
    "blog/posts/*.json",
    "blog/editorial-queue.json",
    "evidence/*.json",
    "faq/*.json",
    "newsletter/*.json",
    "manifest.webmanifest",
]

# Files the page builders make at build time; links to them are fine.
GENERATED = {"blog/index.json"}

# Patterns that look like credentials. The Supabase publishable key and the
# Turnstile site key are public by design, so they are not listed here.
SECRET_PATTERNS = {
    "Anthropic API key": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "OpenAI API key": re.compile(r"sk-(?:proj-)?[A-Za-z0-9]{32,}"),
    "Supabase secret key": re.compile(r"sb_secret_[A-Za-z0-9_-]{10,}"),
    "Resend API key": re.compile(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}"),
    "Stripe secret key": re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}"),
    "Private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "Postgres URL with password": re.compile(r"postgres(?:ql)?://[^:\s/]+:[^@\s]+@"),
}
SECRET_SCAN_SUFFIXES = {".html", ".js", ".py", ".yml", ".yaml", ".json", ".md", ".sql", ".toml", ".txt", ".css"}


class Problems:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, check: str, message: str) -> None:
        self.items.append(f"[{check}] {message}")


def tracked_files() -> list[Path]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True)
    return [ROOT / p for p in out.stdout.decode().split("\0") if p]


def check_json(problems: Problems) -> None:
    for pattern in JSON_GLOBS:
        for path in sorted(ROOT.glob(pattern)):
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as err:
                problems.add("json", f"{path.relative_to(ROOT)} does not parse: {err}")


def check_build(problems: Problems) -> None:
    result = subprocess.run(
        [sys.executable, "scripts/blog_agent/build_index.py"], cwd=ROOT, capture_output=True, text=True
    )
    if result.returncode != 0:
        problems.add("build", f"build_index.py failed:\n{result.stdout}{result.stderr}")
    for line in result.stdout.splitlines():
        if line.startswith("Skipping"):
            problems.add("build", f"build_index.py {line}")


def check_js(problems: Problems, files: list[Path]) -> bool:
    node = shutil.which("node")
    if not node:
        print("note: Node is not installed, so the JavaScript syntax check was skipped")
        return False
    for path in files:
        if path.suffix != ".js":
            continue
        result = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
        if result.returncode != 0:
            problems.add("js", f"{path.relative_to(ROOT)} has a syntax error:\n{result.stderr.strip()}")
    return True


class RefCollector(HTMLParser):
    ATTRS = {"href", "src", "poster", "data-video-src"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []
        self.scripts: list[str] = []
        self.refresh = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for name, value in attrs:
            if name in self.ATTRS and value:
                self.refs.append(value)
            if name == "srcset" and value:
                self.refs.extend(part.strip().split(" ")[0] for part in value.split(",") if part.strip())
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"] or "")
        if tag == "meta" and (values.get("http-equiv") or "").lower() == "refresh":
            self.refresh = True


def exists_exact_case(path: Path) -> bool:
    """True if the path exists with exactly this upper/lower case."""
    try:
        rel = path.resolve().relative_to(ROOT)
    except ValueError:
        return False
    current = ROOT
    for part in rel.parts:
        try:
            names = {p.name for p in current.iterdir()}
        except (FileNotFoundError, NotADirectoryError):
            return False
        if part not in names:
            return False
        current = current / part
    return True


def check_pages(problems: Problems, files: list[Path]) -> None:
    for page in files:
        if page.suffix != ".html":
            continue
        collector = RefCollector()
        collector.feed(page.read_text(encoding="utf-8", errors="replace"))
        rel_page = page.relative_to(ROOT)
        for ref in collector.refs:
            parts = urlsplit(ref)
            if parts.scheme or parts.netloc or ref.startswith(("#", "{", "$")):
                continue  # outside links, mailto:, data:, javascript:, anchors, templates
            if not parts.path:
                continue
            target = (page.parent / unquote(parts.path)).resolve() if not parts.path.startswith("/") \
                else (ROOT / unquote(parts.path).lstrip("/")).resolve()
            if target.is_dir():
                target = target / "index.html"
            try:
                rel_target = target.relative_to(ROOT).as_posix()
            except ValueError:
                problems.add("links", f"{rel_page}: '{ref}' points outside the site")
                continue
            if rel_target in GENERATED:
                continue
            if not exists_exact_case(target):
                problems.add("links", f"{rel_page}: '{ref}' does not exist (check the spelling and case)")
        # games/ pages are self-contained builds, newsletter/ pages are email copies,
        # and forwarding pages carry a meta refresh: none of them need script.js.
        if rel_page.parts[0] not in {"games", "newsletter"} and not collector.refresh:
            if not any(Path(urlsplit(s).path).name == "script.js" for s in collector.scripts):
                problems.add("pages", f"{rel_page} does not load script.js (every page must)")


def check_secrets(problems: Problems, files: list[Path]) -> None:
    for path in files:
        if path.suffix not in SECRET_SCAN_SUFFIXES or path.name == "site_check.py":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                problems.add("secrets", f"{path.relative_to(ROOT)} contains what looks like a {label}")


def main() -> int:
    problems = Problems()
    files = tracked_files()
    check_json(problems)
    check_build(problems)
    js_checked = check_js(problems, files)
    check_pages(problems, files)
    check_secrets(problems, files)

    pages = sum(1 for f in files if f.suffix == ".html")
    print(f"Checked {pages} pages, JSON data, the blog build"
          f"{', JavaScript syntax' if js_checked else ''} and a secret scan.")
    if problems.items:
        print(f"\n{len(problems.items)} problem(s):")
        for item in problems.items:
            print(f"  - {item}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

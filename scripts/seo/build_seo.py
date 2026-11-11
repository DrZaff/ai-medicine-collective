"""Make the site readable to search engines and AI assistants (Netlify build step).

The FAQ, the AI vs Physician paper and the blog are drawn by JavaScript from
JSON files, so crawlers that do not run JavaScript (most AI assistants, and
search engines on their first pass) see an empty page. At deploy time this
script writes the same content into the pages as plain HTML, which the
page's script then replaces as usual, and adds:

  - structured data (JSON-LD): Organization and WebSite on the home page,
    FAQPage on faq.html, ScholarlyArticle on ai-vs-physician.html, Blog on
    blog.html
  - a canonical link on every page in the sitemap that lacks one
  - sitemap.xml (public pages, every blog post, the FAQ) and llms.txt (a
    plain-text guide to the site for AI assistants)

robots.txt is a committed file. sitemap.xml and llms.txt are generated and
gitignored; the page edits must never be committed either, so the script
only writes in place with --write (Netlify's build runs it that way):

    python scripts/seo/build_seo.py                 # report what would change
    python scripts/seo/build_seo.py --out _seo      # write the results to a folder to inspect
    python scripts/seo/build_seo.py --write         # Netlify only: edit the pages in place

Running it twice gives the same result: each insert sits between markers and
replaces what the last run put there. Standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://www.aimedicinecollective.com"
NAME = "AI Medicine Collective"
LOGO = f"{SITE}/images/icon-512.png"

# Public pages worth indexing, most important first. Forwarding pages, sign-in
# and members-only pages are left out.
PAGES = [
    "index.html", "ai-vs-physician.html", "faq.html", "blog.html", "hub.html", "games.html",
    "members.html", "join.html", "corrections.html", "privacy.html", "terms.html",
]
MEMBER_PAGES = "member/*.html"   # the admin team's hand-made pages
BLOG_POSTS_SHOWN = 12            # recent posts written into blog.html

esc = lambda text: html.escape(str(text or ""), quote=True)


def load(path: str) -> dict | None:
    try:
        return json.loads((ROOT / path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def nice(iso: str) -> str:
    try:
        return dt.date.fromisoformat(str(iso)[:10]).strftime("%b %-d, %Y") if sys.platform != "win32" \
            else dt.date.fromisoformat(str(iso)[:10]).strftime("%b %#d, %Y")
    except ValueError:
        return str(iso or "")


def jsonld(data: dict) -> str:
    # "</" can't appear inside a <script>; JSON allows "<\/"
    text = json.dumps(data, ensure_ascii=False, indent=1).replace("</", "<\\/")
    return f'<script type="application/ld+json" data-seo>\n{text}\n</script>'


# ---------------------------------------------------------------- page edits

def between(page: str, name: str, content: str) -> tuple[str, bool]:
    """Put content between <!-- PRERENDER:name:start --> and :end, or in place
    of a lone <!-- PRERENDER:name --> marker. Returns (page, found)."""
    block = f"<!-- PRERENDER:{name}:start -->\n{content}\n<!-- PRERENDER:{name}:end -->"
    pair = re.compile(rf"<!-- PRERENDER:{name}:start -->.*?<!-- PRERENDER:{name}:end -->", re.S)
    if pair.search(page):
        return pair.sub(lambda _: block, page, count=1), True
    if f"<!-- PRERENDER:{name} -->" in page:
        return page.replace(f"<!-- PRERENDER:{name} -->", block, 1), True
    return page, False


def head_extras(page: str, url: str, data: list[dict], canonical: bool = True) -> str:
    """Replace this script's earlier JSON-LD and add a canonical link if missing."""
    page = re.sub(r'\s*<script type="application/ld\+json" data-seo>.*?</script>', "", page, flags=re.S)
    extra = []
    if canonical and not re.search(r'<link[^>]+rel="canonical"', page):
        extra.append(f'<link rel="canonical" href="{esc(url)}" data-seo />')
    extra += [jsonld(d) for d in data]
    if not extra:
        return page
    return page.replace("</head>", "  " + "\n  ".join(extra) + "\n</head>", 1)


# ---------------------------------------------------------------- the FAQ

def faq_html(faq: dict) -> str:
    out = []
    for category in faq["categories"]:
        items = [i for i in faq["items"] if i.get("category") == category["id"]]
        if not items:
            continue
        out.append(f'<section class="faq-group" id="faq-topic-{esc(category["id"])}">')
        out.append(f'<h3 class="subsection-title faq-group-title">{esc(category["name"])}</h3>')
        for item in items:
            answer = esc(item["answer"])
            answer = re.sub(r"\[(\d+)\]", lambda m: f'<a class="review-cite" href="#faq-{esc(item["id"])}-src-{m[1]}">[{m[1]}]</a>', answer)
            out.append(f'<details class="faq-item resource-group" id="faq-{esc(item["id"])}">')
            out.append(f'<summary class="faq-question resource-summary">{esc(item["question"])}</summary>')
            out.append(f'<div class="faq-answer resource-body"><p class="faq-text">{answer}</p>')
            if item.get("sources"):
                out.append('<p class="faq-sources-label">Sources</p><ol class="faq-sources">')
                for n, source in enumerate(item["sources"], 1):
                    meta = ", ".join(x for x in [source.get("source"), nice(source.get("published")) if source.get("published") else ""] if x)
                    out.append(f'<li id="faq-{esc(item["id"])}-src-{n}"><a class="faq-source-title" href="{esc(source["url"])}" '
                               f'rel="noopener noreferrer">{esc(source["title"])}</a> <span class="faq-source-meta">{esc(meta)}</span></li>')
                out.append("</ol>")
            out.append(f'<p class="faq-meta">Last reviewed {esc(nice(item.get("updated") or faq.get("updated")))}</p></div></details>')
        out.append("</section>")
    return "\n".join(out)


def faq_data(faq: dict) -> dict:
    # Plain text for answer engines: no [1] markers, sources named instead
    def text(item):
        answer = re.sub(r"\s*\[\d+\]", "", item["answer"])
        named = "; ".join(f'{s["title"]} ({s.get("source", "")})' for s in item.get("sources", []))
        return f"{answer} Sources: {named}." if named else answer
    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "name": "Frequently asked questions: AI in medicine",
        "url": f"{SITE}/faq.html",
        "dateModified": faq.get("updated"),
        "publisher": {"@type": "Organization", "name": NAME, "url": SITE},
        "mainEntity": [
            {"@type": "Question", "name": item["question"], "url": f'{SITE}/faq.html#faq-{item["id"]}',
             "dateCreated": item.get("added"),
             "acceptedAnswer": {"@type": "Answer", "text": text(item), "url": f'{SITE}/faq.html#faq-{item["id"]}',
                                "dateModified": item.get("updated")}}
            for item in faq["items"]
        ],
    }


# ---------------------------------------------------------------- the paper

def review_html(review: dict) -> str:
    studies = sorted(review["studies"], key=lambda s: str(s.get("published", "")), reverse=True)
    number = {s["id"]: i + 1 for i, s in enumerate(studies)}
    cite = lambda text: re.sub(r"\[(S\d+)\]", lambda m: f"[{number[m[1]]}]" if m[1] in number else "", esc(text))
    out = [
        '<article class="review">',
        f'<p class="review-meta">Edition {esc(review.get("edition"))} · Updated {esc(nice(review.get("updated")))} · {len(studies)} studies</p>',
        f'<h3 class="review-title">{esc(review.get("title"))}</h3>',
        f'<p class="review-summary">{cite(review.get("summary"))}</p>',
    ]
    if review.get("key_findings"):
        out.append('<section class="review-findings"><h4 class="review-heading">Key findings</h4><ol class="review-list">')
        out += [f"<li>{cite(f)}</li>" for f in review["key_findings"]]
        out.append("</ol></section>")
    for section in review.get("sections", []):
        out.append(f'<section class="review-section"><h4 class="review-heading">{esc(section.get("heading"))}</h4>')
        out += [f'<p class="review-text">{cite(p)}</p>' for p in section.get("paragraphs", [])]
        out.append("</section>")
    if review.get("open_questions"):
        out.append('<section class="review-section"><h4 class="review-heading">What the evidence cannot tell us yet</h4><ul class="review-list">')
        out += [f"<li>{cite(q)}</li>" for q in review["open_questions"]]
        out.append("</ul></section>")
    out.append(f'<section class="review-section"><h4 class="review-heading">The studies ({len(studies)})</h4><ol class="review-studies">')
    for s in studies:
        out.append(f'<li class="review-study" id="study-{esc(s["id"])}"><a class="review-study-title" href="{esc(s.get("url"))}" '
                   f'rel="noopener noreferrer">{esc(s.get("title"))}</a>'
                   f'<p class="blog-source">{esc(" · ".join(x for x in [s.get("source"), nice(s.get("published")), s.get("design")] if x))}</p>'
                   f'<p class="review-text">{esc(s.get("finding"))}</p></li>')
    out.append("</ol></section></article>")
    return "\n".join(out)


def review_data(review: dict) -> dict:
    first = min((c.get("date") for c in review.get("changes", []) if c.get("date")), default=review.get("updated"))
    return {
        "@context": "https://schema.org",
        "@type": ["ScholarlyArticle", "MedicalWebPage"],
        "headline": review.get("title") or "AI vs Physician",
        "name": "AI vs Physician: a living review of AI and physician performance",
        "url": f"{SITE}/ai-vs-physician.html",
        "abstract": re.sub(r"\s*\[S\d+\]", "", review.get("summary", "")),
        "datePublished": first,
        "dateModified": review.get("updated"),
        "version": str(review.get("edition", "")),
        "author": {"@type": "Organization", "name": NAME, "url": SITE},
        "publisher": {"@type": "Organization", "name": NAME, "url": SITE, "logo": LOGO},
        "about": ["Artificial intelligence in medicine", "Clinical decision support", "Large language models"],
        "audience": {"@type": "MedicalAudience", "audienceType": "Clinician"},
        "isAccessibleForFree": True,
        "citation": [{"@type": "ScholarlyArticle", "name": s.get("title"), "url": s.get("url")}
                     for s in review.get("studies", []) if s.get("url")],
    }


# ---------------------------------------------------------------- the blog

def blog_posts() -> list[dict]:
    posts = []
    for path in sorted((ROOT / "blog" / "posts").glob("*.json"), reverse=True):
        try:
            post = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if post.get("date") and post.get("items"):
            posts.append(post)
    return posts


def blog_html(posts: list[dict]) -> str:
    out = ['<section class="blog-prerender">']
    for post in posts[:BLOG_POSTS_SHOWN]:
        out.append(f'<article class="blog-post"><p class="blog-date">{esc(nice(post["date"]))}</p>'
                   f'<h3 class="blog-headline"><a href="blog.html?date={esc(post["date"])}">{esc(post.get("headline"))}</a></h3>'
                   f'<p class="blog-intro">{esc(post.get("intro"))}</p>')
        for item in post["items"]:
            out.append(f'<div class="blog-item"><h4 class="blog-item-title"><a href="{esc(item.get("url"))}" rel="noopener noreferrer">'
                       f'{esc(item.get("title"))}</a></h4><p class="blog-source">{esc(item.get("source"))}</p>'
                       f'<p class="blog-summary">{esc(item.get("summary"))}</p>'
                       + (f'<p class="blog-why">Why it matters: {esc(item["why_it_matters"])}</p>' if item.get("why_it_matters") else "")
                       + "</div>")
        out.append("</article>")
    out.append("</section>")
    return "\n".join(out)


def blog_data(posts: list[dict]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "AI Medicine Collective briefings",
        "url": f"{SITE}/blog.html",
        "publisher": {"@type": "Organization", "name": NAME, "url": SITE},
        "blogPost": [{"@type": "BlogPosting", "headline": p.get("headline"), "datePublished": p["date"],
                      "url": f'{SITE}/blog.html?date={p["date"]}', "author": {"@type": "Organization", "name": NAME}}
                     for p in posts[:BLOG_POSTS_SHOWN]],
    }


def site_data() -> list[dict]:
    org = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": NAME,
        "url": SITE,
        "logo": LOGO,
        "description": "An independent, volunteer-run community of clinicians and trainees who build and evaluate AI "
                       "tools for medicine, and publish evidence on AI in medicine and medical education.",
        "sameAs": ["https://www.instagram.com/aimedicinecollective/"],
        "knowsAbout": ["Artificial intelligence in medicine", "Medical education", "Clinical decision support",
                       "Large language models in health care", "Building medical apps with AI"],
    }
    site = {"@context": "https://schema.org", "@type": "WebSite", "name": NAME, "url": SITE,
            "publisher": {"@type": "Organization", "name": NAME, "url": SITE}}
    return [org, site]


# ---------------------------------------------------------------- sitemap, llms.txt

def sitemap(posts: list[dict], faq: dict | None, review: dict | None) -> str:
    rows = []
    lastmod = {"faq.html": faq and faq.get("updated"), "ai-vs-physician.html": review and review.get("updated"),
               "blog.html": posts[0]["date"] if posts else None}
    member_pages = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob(MEMBER_PAGES))
    for page in PAGES + member_pages:
        if not (ROOT / page).exists():
            continue
        loc = SITE + "/" if page == "index.html" else f"{SITE}/{page}"
        mod = f"<lastmod>{lastmod[page]}</lastmod>" if lastmod.get(page) else ""
        rows.append(f"  <url><loc>{xml_escape(loc)}</loc>{mod}</url>")
    for post in posts:
        rows.append(f'  <url><loc>{xml_escape(f"{SITE}/blog.html?date={post["date"]}")}</loc><lastmod>{post["date"]}</lastmod></url>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(rows) + "\n</urlset>\n")


def llms_txt(posts: list[dict], faq: dict | None, review: dict | None) -> str:
    lines = [
        f"# {NAME}",
        "",
        "> An independent, volunteer-run community of clinicians and trainees who build and evaluate AI tools "
        "for medicine. The site publishes a living review of studies comparing AI with physicians, evidence "
        "briefings on AI in medicine and medical education three times a week, evidence-based answers to common "
        "questions, and tools built by members. Educational only; not medical advice.",
        "",
        "Every claim on the evidence pages is tied to a cited primary source. Drafts are written by AI agents "
        "and reviewed by a person before publishing; corrections policy: " + f"{SITE}/corrections.html",
        "",
        "## Key pages",
        f"- [AI vs Physician: a living review]({SITE}/ai-vs-physician.html): how AI on its own, and clinicians "
        "working with AI, compare with physicians, built on randomized and prospective landmark studies; rewritten monthly"
        + (f" (edition {review.get('edition')}, updated {review.get('updated')}, {len(review.get('studies', []))} studies)" if review else ""),
        f"- [FAQ: AI in medicine]({SITE}/faq.html): short, sourced answers about AI accuracy, automation bias, "
        "deskilling, ambient scribes, HIPAA, FDA rules, medical education and building medical apps with AI",
        f"- [Evidence briefings]({SITE}/blog.html): two reviews per post, one on AI in medical education and one "
        "study comparing AI with clinicians",
        f"- [Tools]({SITE}/hub.html): apps and calculators built by members",
        f"- [Join]({SITE}/join.html): anyone interested in AI in medicine can request membership",
    ]
    if faq:
        lines += ["", "## Frequently asked questions"]
        lines += [f'- [{i["question"]}]({SITE}/faq.html#faq-{i["id"]})' for i in faq["items"]]
    if posts:
        lines += ["", "## Recent briefings"]
        lines += [f'- [{p.get("headline")}]({SITE}/blog.html?date={p["date"]}) ({p["date"]})' for p in posts[:BLOG_POSTS_SHOWN]]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- main

def build() -> tuple[dict[str, str], list[str]]:
    """Every file to write, as {path: text}, and a report."""
    files, report = {}, []
    faq, review, posts = load("faq/faq.json"), load("evidence/ai-vs-human.json"), blog_posts()

    def edit(page: str, fn) -> None:
        path = ROOT / page
        if not path.exists():
            report.append(f"{page}: missing, skipped")
            return
        before = path.read_text(encoding="utf-8")
        after = fn(before)
        if after != before:
            files[page] = after

    def do_faq(page):
        if not faq:
            report.append("faq.html: faq/faq.json missing or unreadable; page left as is")
            return page
        page, found = between(page, "faq", faq_html(faq))
        report.append(f"faq.html: {len(faq['items'])} answers written in" if found else "faq.html: no PRERENDER:faq marker")
        return head_extras(page, f"{SITE}/faq.html", [faq_data(faq)])

    def do_review(page):
        if not (review and review.get("sections")):
            report.append("ai-vs-physician.html: no paper to write in")
            return head_extras(page, f"{SITE}/ai-vs-physician.html", [])
        page, found = between(page, "review", review_html(review))
        report.append("ai-vs-physician.html: paper written in" if found else
                      "ai-vs-physician.html: no PRERENDER:review marker yet; structured data only")
        return head_extras(page, f"{SITE}/ai-vs-physician.html", [review_data(review)])

    def do_blog(page):
        page, found = between(page, "blog", blog_html(posts))
        report.append(f"blog.html: {min(len(posts), BLOG_POSTS_SHOWN)} recent posts written in" if found else "blog.html: no PRERENDER:blog marker")
        # No canonical link: each post is the same file at blog.html?date=..., and a
        # canonical pointing at blog.html would tell search engines to drop them
        return head_extras(page, f"{SITE}/blog.html", [blog_data(posts)] if posts else [], canonical=False)

    edit("faq.html", do_faq)
    edit("ai-vs-physician.html", do_review)
    edit("blog.html", do_blog)
    edit("index.html", lambda page: head_extras(page, SITE + "/", site_data()))
    for page in PAGES[4:] + sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob(MEMBER_PAGES)):
        edit(page, lambda text, page=page: head_extras(text, f"{SITE}/{page}", []))

    files["sitemap.xml"] = sitemap(posts, faq, review)
    files["llms.txt"] = llms_txt(posts, faq, review)
    report.append(f"sitemap.xml: {files['sitemap.xml'].count('<url>')} addresses")
    return files, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--write", action="store_true", help="Edit the pages in place (Netlify build only; never commit the result)")
    target.add_argument("--out", type=Path, help="Write the results into this folder instead")
    args = parser.parse_args()

    files, report = build()
    print("\n".join(report))
    if not (args.write or args.out):
        print(f"Dry run: {len(files)} files would be written. Use --out DIR to inspect them.")
        return 0
    for rel, text in files.items():
        dest = (ROOT if args.write else args.out) / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {len(files)} files to {'the site' if args.write else args.out}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

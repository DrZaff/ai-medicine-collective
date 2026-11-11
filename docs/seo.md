# Being found: search engines and AI assistants

How the site makes itself easy for Google, Bing and AI assistants (ChatGPT, Claude, Perplexity, Google's AI answers) to find, read and cite, and the few steps only the owner can do.

## An honest expectation

No one can guarantee that a site is listed first, or quoted first in an AI answer, for every search about AI in medicine. Search engines and AI assistants choose sources themselves, and large organizations (journals, health systems, government sites) start with a big head start. What reliably moves a site up:

1. **Content they can read.** Pages built by JavaScript are often invisible to AI crawlers. The site now writes its FAQ, the AI vs Physician paper and recent briefings into the pages as plain text at every deploy.
2. **Clear, specific, sourced answers.** Each FAQ answer opens with a one-sentence bottom line and cites primary studies. That is the format answer engines quote.
3. **Steady publishing.** A new FAQ answer every other day, briefings three times a week and a monthly paper all tell search engines the site is alive.
4. **Other sites linking to you.** This matters most and can't be automated. Links from residency program pages, medical school AI resources, society newsletters, conference talks, and posts by members and faculty carry real weight. Ask for them.
5. **Being cited.** When people share an answer's link (each has "Copy link" and "Cite this answer"), search engines take note.

Expect months, not days. Check progress in the tools below.

## One-time steps for the owner

You need the Porkbun login (where the domain is registered). Each step takes about 10 minutes.

### 1. Google Search Console (Google search and Google's AI answers)

1. Go to https://search.google.com/search-console and sign in with your Google account.
2. Choose **Add property** → **Domain**, and type `aimedicinecollective.com`.
3. Google shows a **TXT record** (a line starting `google-site-verification=`). Copy it.
4. In Porkbun: **Domain Management** → `aimedicinecollective.com` → **DNS** → add a record of type **TXT**, host left blank, answer = the line you copied. Save.
5. Back in Search Console, press **Verify**. (If it fails, wait 30 minutes and try again.)
6. In Search Console, open **Sitemaps**, type `sitemap.xml`, and press **Submit**.
7. Optional: open **URL inspection**, paste `https://www.aimedicinecollective.com/faq.html`, and press **Request indexing**. Do the same for `ai-vs-physician.html`.

### 2. Bing Webmaster Tools (Bing, plus ChatGPT search and Microsoft Copilot, which draw on Bing)

1. Go to https://www.bing.com/webmasters and sign in.
2. Choose **Import from Google Search Console**. It copies the verified site and the sitemap in one step. (Or add the site by hand and verify it with the same kind of TXT record.)
3. Check that `https://www.aimedicinecollective.com/sitemap.xml` is listed under **Sitemaps**.

### 3. Optional: IndexNow

Bing Webmaster Tools offers **IndexNow**, which lets the site tell Bing about new pages the moment they are published. It needs a small key file on the site and a step in the deploy; ask Claude to set it up once steps 1 and 2 are done.

## What the site does by itself

- `robots.txt` welcomes search engines and AI crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Bingbot, Applebot and others) and points them to the sitemap. Sign-in and moderation pages are left out.
- Every deploy builds `sitemap.xml` (every public page and every briefing) and `llms.txt` (a plain-text guide to the site for AI assistants), and writes the FAQ, the paper and recent briefings into the pages with structured data (schema.org FAQPage, ScholarlyArticle, Blog, Organization) that tells search engines and AI assistants what each page is.
- The FAQ agent adds a sourced answer every other day, and the monthly audit checks links and adds new questions people are likely to ask. Every answer is reviewed before it is published: merging the pull request is the review.

## Checking it worked

- After the next deploy, open https://www.aimedicinecollective.com/sitemap.xml and https://www.aimedicinecollective.com/llms.txt; both should show text.
- Paste `https://www.aimedicinecollective.com/faq.html` into the Schema Markup Validator (https://validator.schema.org); it should find an FAQPage with every question. (Google shows FAQ drop-downs in its own results only for a few well-known government and health sites, so don't expect those; the structured data still helps search engines and AI assistants understand and quote the answers.)
- In Search Console, **Performance** shows which searches bring people to the site, a few weeks after verification. Share the top queries with Claude now and then: they are the best guide to which questions to answer next.

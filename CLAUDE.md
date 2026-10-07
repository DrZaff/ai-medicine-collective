# CLAUDE.md — AI Medicine Collective website

Guidance for Claude (and any contributor) working in this repo. Read it fully before making changes.

## Project overview

Club website for the AI Medicine Collective, a group of residents (IM, Med/Peds, EM) building AI tools for medicine.

- **Stack today:** plain static HTML, one shared stylesheet (`style.css`), one shared script (`script.js`), plus `auth.js` (sign-in, account and moderation pages only). No framework. Backend is Supabase (see "Backend" below).
- **Forms:** the Join form posts to Formspree (`https://formspree.io/f/mqaonqpr`).
- **Hosting:** Netlify (site `ai-medicine-collective`, https://ai-medicine-collective.netlify.app), connected to this repo: every PR gets a deploy preview (`deploy-preview-<N>--ai-medicine-collective.netlify.app`) and every merge to `main` publishes to production.
- **Login (phase 2):** Supabase Auth with Google sign-in, members only. The Supabase project and Google client were set up on 2026-10-03 following [docs/auth-setup.md](docs/auth-setup.md).
- **Who sees what (decided):** signed-out visitors see Home, About, Members (the admin team only; the member list is for signed-in members), Join, the Blog, Tools, and **published projects in the Projects hub** (read-only: description, links, files, author name). Submitting, comments, private messages, Learning Materials and Chat are members-only, enforced by database rules rather than hidden pages.
- **Build step:** Netlify runs `python3 scripts/blog_agent/build_index.py` (see `netlify.toml`), which generates `blog/index.json`. That file is gitignored; run the script locally before previewing `blog.html`.

## Backend (Supabase)

- **Project URL:** `https://ahwnarhmuzxgjindreuz.supabase.co`
- **Publishable key (public by design, safe in site code):** `sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT`
- **Never in the repo or chat:** the secret / `service_role` key, the database password, the Google client secret (Rule 2).
- **Roles** (`public.profiles.role`): `pending` → `member` → `moderator` → `admin`, plus `rejected`. New sign-ins get a `pending` profile automatically. Roles change only through the SQL functions `approve_member`, `reject_member` (moderators) and `set_member_role` (admins), never by editing the column.
- **Tables so far:** `profiles` (001); `join_details` (002: role, program, interests, message; readable by the person and moderators only); `projects` and `project_comments` plus the private storage bucket `project-files` (003); `material_folders` and the `kind`/`folder` columns on `projects` (004); `chat_topics` and `chat_messages` (005); `project_messages` (006); `projects.doc_url`, public read of published projects, and the Collective's 16 tools seeded as projects (007); profile fields on `profiles` (008); `tool_requests`, `tool_request_votes`, `learning_path_items` and `learning_progress` (009); `chat_messages.project_id` and the publish-announcement trigger (010); `profiles.email_alerts` and the inbox alert trigger (011); `profiles.institution` (012; its opt-in public list was replaced by 014: `profiles.directory_listing`, default on, and `public_members()` dropped); `profiles.email_digest`, `digest_sends` and `send_digest()` (013). Option lists in `auth.js` and `hub.js` must match the CHECK constraints in the migrations.
- **Member emails are private (006):** `authenticated` can select only `id, full_name, avatar_url, role, created_at, approved_at, approved_by` from `profiles`. Never add `email` to a `profiles` select or embed. A person's own email comes from their session (`session.user.email`); moderators get the list through `member_emails()`.
- **Database changes are migration files:** add `supabase/migrations/NNN_description.sql` (next number, never edit one that has been run). The owner runs each file once in the Supabase SQL Editor; Claude has no database access and verifies through the public API only.
- **Every new table must:** enable row level security, have explicit policies, and `grant` only what's needed to `authenticated` (the project has "automatically expose new tables" off). Signed-out visitors (`anon`) get no table access. Use `public.is_member()`, `is_moderator()` and `is_admin()` in policies.
- **Email (set up 2026-10-04):** the Collective owns `aimedicinecollective.com` (Porkbun). Resend sends from the verified subdomain `mail.aimedicinecollective.com`; Supabase Auth uses it through custom SMTP (sender `noreply@mail.aimedicinecollective.com`). The Resend key lives only in Supabase: the SMTP settings, and Supabase Vault under the name `resend_api_key` for emails the database sends itself (Rule 2).
- **Inbox alert emails (migration 011):** a trigger on `project_messages` asks Resend (through `pg_net`) to email the recipient a notice with a link to `inbox.html`, never the message text. At most one per person per 30 minutes; members switch it off with `profiles.email_alerts` on the profile form. No Vault secret means no email, and a sending failure never blocks the message.
- **Sign-in on the site:** `account.html` (Google sign-in or a one-time code emailed to the person, `signInWithOtp` + `verifyOtp`; no passwords; status, display name, sign out) and `moderate.html` (approve/decline requests; admins set roles). Both load the pinned Supabase library (with an integrity hash) and `auth.js`. Other pages only check `localStorage` for the session key to relabel the nav's SIGN IN link as ACCOUNT; that is cosmetic. For approved members the account page is a **dashboard**: one card per area (inbox, my submissions, chat, directory, hub, learning, plus moderation for moderators), each filled in the background with a live count; a card whose count fails still works as a link. `auth.js` also saves the person's role as a hint (`amc-member-role`), which `script.js` uses to add a **Members area** row (Projects hub, Learning, Chat, Inbox with an unread count from the `amc-unread` hint, plus Moderation for moderators) under the header on every page for approved members. Also cosmetic: the member pages and the database still check the real role. `auth.js` and `script.js` share one global scope on those two pages, so top-level names must not collide.
- **Projects hub (`hub.html`, `hub.js`):** members submit a project (title, category, description, optional https link, optional file up to 10 MB) → `pending` → a moderator publishes or rejects it (`review_project`) → published projects are visible to approved members, with comments and a **private message to the author** (`project_messages`, readable only by sender and recipient; the author reads and answers in `inbox.html`, and no email address is shown). Authors can edit their own items until they're published and resubmit rejected ones (`resubmit_project`). Only moderators can delete projects. Pending submissions also appear on `moderate.html`. Files are private; the page asks Supabase for a short-lived link to open one. Published projects are public (signed-out visitors use `PROJECT_PUBLIC_COLUMNS`; `me` is null in the read-only view). `projects.html` now just forwards to the hub; `appstore.html` stays as the icon launcher for the five apps, which are also listed in the hub. Items can carry a second link, `doc_url` ("Instructions").
- **Learning Materials (`learn.html`) is the same pipeline, not a second one:** materials are `projects` rows with `kind = 'material'`, a `folder` (from `material_folders`, which moderators can add to) and a type (presentation, module, guide, video, other). `hub.js` serves both pages; the page picks the kind with `data-kind` on `#hub-app`, and everything kind-specific lives in `HUB_KINDS`. Add a third kind there rather than copying the code. Uploads are capped at 25 MB.
- **Member profiles (`directory.html`, `profile.html`, `profiles.js`):** approved members fill in program, training level, focus areas, bio, an optional contact address and link from the account page (`#profile`); other approved members see them in the directory. Members-only. `contact_email` is an address the member chose to show; the sign-in email stays private. **Members page (`members.html`):** two parts. The *admin team* is hand-written HTML: seven cards linking to the hand-made pages in `member/` (on 2026-10-06 the owner removed four people from that list; their pages and photos were deleted). Below it, *Members* is the members-only directory (`#directory-app`, filled by `profiles.js`, so the page loads the Supabase library): every approved member appears automatically unless they untick "Show me in the member list" (`profiles.directory_listing`, migration 014), with search and an institution filter. Signed-out visitors see a sign-in prompt there. Decided by the owner on 2026-10-06: members are visible to other members only, never publicly. Hiding is a courtesy at the list level: a hidden member's profile still opens from their projects and chat messages.
- **Tools (`tools.html`, `initTools` in `script.js`):** the one-tap launcher, and the page meant to be saved to a phone's home screen (`manifest.webmanifest`, icons in `images/icon-*.png`). It is not a separate list: every published project with a link is a tool, read with a plain `fetch` like the home page. Icons for the Collective's own apps are mapped by web address in `TOOL_ICONS`; other tools get a lettered tile. "+ ADD YOUR TOOL" is the hub's submit form. The five apps in the page's HTML are only a fallback. `appstore.html` forwards here.
- **Tool requests (`requests.html`, `requests.js`, migration 009):** members post "I wish there were a tool for X", upvote (one vote each, a toggle), claim one ("I'll build this"), and mark it built with an optional link to the published project. Members-only and not pre-moderated, like chat; moderators can delete. Status changes go through `claim_tool_request`, `release_tool_request` and `complete_tool_request`, never a direct update.
- **Core path (on `learn.html`, in `hub.js`, migration 009):** a short ordered list of published materials that moderators pick from the members' library (ADD TO CORE PATH on a material's page). Members mark steps done (`learning_progress`); finishing every step shows CORE PATH COMPLETE on their profile. The library stays open to every member's contributions; the path is the curated front of it. Don't build a second library.
- **Citations:** every published project and material has a "Cite this" line (`citationFor` in `auth.js`, always using the live site address), and a member's own profile has COPY ALL FOR MY CV.
- **Getting started:** the dashboard shows new members four first steps (profile, try a tool, say hello in chat, vote or post a request) until all are done or they hide it.
- **Topic chat (`chat.html`, `chat.js`):** approved members post in topics; moderators add topics (archive rather than delete; ARCHIVE/RESTORE TOPIC buttons on the chat page) and can delete any message, members their own; messages can't be edited. New messages arrive through Supabase Realtime (`chat_messages` is in the `supabase_realtime` publication), with a 20-second poll as a safety net. Messages load 50 at a time. When a moderator publishes a project, a database trigger posts one message about it in the "Show and tell" topic (migration 010); the chat page adds an OPEN IN THE HUB link to those. Renaming or archiving that topic switches the announcements off.
- `auth.js`, `hub.js`, `chat.js`, `inbox.js`, `profiles.js`, `requests.js` and `script.js` share one global scope on the pages that load them, so their top-level names must not collide.
- Members-only means **the data is protected by these rules**. Page files are always public, so never put member content in static HTML.

## Blog agent

- **Flow:** `.github/workflows/blog-draft.yml` is scheduled for about 3 AM Eastern on Monday, Wednesday and Friday (early because GitHub often starts scheduled jobs hours late; if a run fails with a GitHub runner error, re-run it from the Actions tab). `scripts/blog_agent/agent.py` asks Claude (`claude-opus-5-5`, web search and fetch, structured JSON output, `fallbacks: "default"`) for the last 7 days of AI-in-medical-education news and research (med-ed first, at most two general AI-in-medicine items), then writes `blog/posts/YYYY-MM-DD.json` and opens a PR titled `Blog draft: <date>`. **Merging the PR is the human review that publishes the post**; closing it skips that post.
- **Safeguards in the script:** an item is kept only if its URL appeared in that run's search or fetch results (no invented links). Items covered in the last 21 days are dropped. Dropped items are listed in the PR. The prompt forbids patient information.
- **Weekly newsletter:** `.github/workflows/weekly-newsletter.yml` (Friday afternoons) runs `scripts/blog_agent/newsletter.py`. It builds the weekly digest: the week's merged posts plus projects newly published in the hub (read from the public API), written to `newsletter/<date>.html` (email-ready, inline styles) and `.txt`, then opens a PR. It makes no AI call. **Sending:** after that PR is merged, an admin opens `moderate.html`, sends a test copy to themselves, then presses SEND TO MEMBERS. The page reads the published `newsletter/<date>` files and calls `send_digest()` (migration 013), which emails approved members who haven't switched off `profiles.email_digest` (offered as a tick box when they first request membership, and under "Your profile" afterwards), one message each through Resend, and records the week in `digest_sends` so it can't be sent twice. Members only; there is no public mailing list. Resend's free plan allows 100 emails a day, so past roughly 100 recipients the plan needs upgrading.
- **Secrets:** only `ANTHROPIC_API_KEY`, stored as a GitHub Actions secret by the owner. Without it, the blog workflow skips quietly. Both workflows also need the setting *Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"*.
- **Testing without the API:** `python scripts/blog_agent/agent.py --fixture sample.json --date YYYY-MM-DD` (see the script's docstring). Never commit test posts.
- **Post files are data, not HTML:** `script.js` renders posts with `textContent` only. Keep it that way, because post text comes from an AI draft.
- **Home page (`index.html`):** a hero, three panels and a tile grid. "Latest briefing" reads `blog/index.json`; "New in the hub" asks Supabase for the newest published projects with a plain `fetch` and the publishable key (`initHome` in `script.js`; the home page does not load the Supabase library). Both keep their plain HTML text if the request fails. **"Next meeting" is plain HTML: update it together with `schedule.html`.**
- **Preview locally:** serve the folder (e.g. `python -m http.server`) and open `http://localhost:8000`. Don't just double-click files; that hides path bugs.

## Non-negotiable rules

### 1. Branches and pull requests
- Never commit directly to `main`.
- Every change goes on its own branch (`feature/...`, `fix/...`, `design/...`) and is merged through a pull request.
- One logical change per PR. The description says what changed, why, and how it was checked (pages opened, desktop + phone width).
- Don't merge your own PR without the owner's approval.

### 2. No secrets in the repo
- Never commit API keys, tokens, passwords, database URLs, service-account files, or `.env` files. The repo is **public**.
- Secrets live in the hosting provider's environment variables or a secrets manager. Keep `.env*` in `.gitignore`.
- If a secret is ever committed, treat it as leaked: rotate it immediately. Deleting the commit is not enough.
- Client-side code is public. Anything in HTML/JS is visible to everyone and is **not** security; access control lives in the database rules.

### 3. No patient information, anywhere
- No protected health information (PHI) on the site, in the repo, in uploads, comments, chat, blog posts, social posts, or newsletters. That includes names, dates, MRNs, images, case details, or anything that could identify a patient.
- Example cases, screenshots, and test data must be fully synthetic.
- Every user-content feature (submissions, comments, chat, uploads) must state this rule where users post, and give moderators a way to remove content.
- AI-generated content (blog agent, summaries) must never be fed patient data, and is checked for PHI before publishing.

### 4. Filenames are case-sensitive
Web servers treat `Sam.html` and `sam.html` as different files. Use **lowercase-kebab-case** for all new files and folders (`member/sam-schoenl.html`, `images/app-logos/qtc-logo-512.png`), and make links match exactly. Use relative paths (`minutes/file.pdf`), not root paths (`/minutes/file.pdf`).

## Design system: "minimalist hacker terminal"

Every page must look like it belongs on a green-phosphor terminal. Follow these rules for all new and changed UI. If the design refresh (Roadmap phase 1) changes a rule, update this section in the same PR.

### Colors
Use the CSS variables; don't hard-code new colors.

| Token | Value | Use |
|---|---|---|
| `--bg-inner` | `#000000` | Page background |
| `--bg` | `#020802` | Terminal frame background (radial gradient `#051505` → `--bg` → `#000`) |
| `--text` | `#00ff66` | **Bright:** headings, links, buttons, names, key numbers. Not for paragraphs |
| `--body` | `#e9f1eb` | **Body:** anything people read (paragraphs, descriptions, form text). Near-white on purpose: green body text was reported as hard to read. The default text color |
| `--muted` | `#9db8a6` | **Muted:** secondary detail (notes, dates, captions). Use this instead of `opacity` on text |
| `--accent` | `#00cc55` | Borders, rules, highlights |
| `--error` | `#ff5555` | Errors only |
| `--line`, `--line-strong` | green at 25% / 45% | Card and panel borders |
| `--panel` | `rgba(0,0,0,0.72)` | Card and panel fill |
| `--glow` | soft green `box-shadow` | Hover glow on cards |

Secondary accents, each with **one job only**:
- Cyan `#00e5ff` (`--cyan`): link hover, "Instructions" buttons, the NEW tag in the directory
- Yellow `#ffe600` (`--yellow`): "Launch" / primary-action buttons (JOIN, `.btn--primary`) and "something is waiting for you" (unread inbox, dashboard alerts)
- Pink `#ff4da6` (`--pink`): "< Back" links and the Join submit button
- Department tags: IM `#00ff66`, Med/Peds `#00ffd5`, EM `#ffb347`

No other hues. No white backgrounds, no light mode, no gradients beyond the subtle dark radial ones, the faint page grid and the scanline overlay (both defined once on `body`; the scanlines are switched off on phones, where they cost the most legibility).

### Typography
- Three stacks, no web fonts. **Reading text is not monospace** (changed 2026-10-07 after members said the small green monospace text was hard to digest, especially on phones): `--font-read` (the device's plain system font) for anything longer than a line or two — paragraphs, descriptions, blog summaries, chat messages. Give a new reading element a class from the `--font-read` rule in `style.css`, or no class at all inside `.section`. The terminal voice stays monospace: `--font-display` (Courier New) for headings, the hero and big numbers; `--font-body` (the device's own sturdier monospace: Cascadia Mono / Consolas / SF Mono / Menlo / Roboto Mono) for everything people read. Form controls inherit the body font.
- Three text levels (bright / body / muted, see Colors). Bright is for what the eye should land on; if everything is bright, nothing is. Nav links are body-colored until hovered or current.
- Headings and labels are UPPERCASE with letter-spacing `0.08em`; the site headline uses `0.1em`.
- Reading text is at least `1rem` (16px) at line-height `1.5–1.65`; notes and labels no smaller than about `0.78rem`. Don't go below that to make something fit: shorten the text instead.
- **Blog feed:** each story shows its category, headline, source and the "Why it matters" takeaway; the longer summary is folded behind "Read the summary" so the page can be skimmed.
- Inputs and buttons are at least `16px` on phones (prevents iOS zoom).

### Terminal-style elements (use these, don't invent new ones)
- **Frame:** all content inside `.terminal-frame`: max-width `1000px`, `1px solid var(--accent)` border, green glow, and bright corner brackets (its `::before`/`::after`). The page behind it has a faint green grid and CRT scanlines.
- **Status strip:** the first `<div class="horizontal-rule">` inside the frame is styled as a status strip (`AMC://COLLECTIVE … [ SYSTEM ONLINE ]`). Keep that div as the frame's first child on every page.
- **Header:** `:: AI MEDICINE COLLECTIVE ::` centered and **linking to the home page** (there is no HOME item), followed by the shared `.nav` and a `.horizontal-rule`. The nav is seven links (ABOUT, MEMBERS, MEETINGS, TOOLS, PROJECTS, RESOURCES, BLOG) plus two buttons: JOIN (yellow, `data-signed-out-only`, hidden once signed in) and SIGN IN / ACCOUNT. Don't add more top-level items; member pages are reached from the Members area row. The home page is the one exception: it has no nav, because its Explore grid does that job; its hero carries the JOIN and SIGN IN / ACCOUNT buttons. `script.js` marks the current page (`aria-current="page"`) and, on phones (≤600px), collapses the nav behind a `> MENU [+]` toggle, so **every page must load `script.js`**.
- **Page title:** `.section-title` draws a bright block before the title and a line after it. Keep its content plain text.
- **Rules:** sections separated by `1px dashed var(--accent)` (`.horizontal-rule`, `.section-divider`).
- **Link buttons:** `.btn` (green) and `.btn--primary` (yellow) for links that should look like buttons.
- **Loading and empty states:** member pages show `loadingBlock()` while they load (not a bare line of text) and `emptyState(title, text, linkText, href)` when a list is empty, with a next step where there is one. Both live in `auth.js`.
- **Focus:** keyboard focus always shows a green outline (`:focus-visible`). Animations are switched off for people who ask for reduced motion.
- **Voice:** captions and notes written as code comments (`// Current roster`); links and prompts prefixed with `>` (`> PASSWORD:`, `> ABOUT`); back links are `< Back`.
- **Footer:** `> echo "BUILDING INTELLIGENT HEALTHCARE TOGETHER"` + blinking `█` cursor, on every page.
- **Glow, not shadow:** hover and focus states add a green `text-shadow` / `box-shadow` glow (e.g. `0 0 8px rgba(0,255,102,0.5)`). No drop shadows, no blur.
- **Boxes and cards:** near-black fill `rgba(0,0,0,0.7–0.85)`, `1px` green border at ~25–40% opacity, brightening to `--accent` on hover. Square corners (`0–4px`); pills (`999px`) only for buttons and tags.
- **Buttons:** transparent background, `1px` colored border, UPPERCASE text, faint tinted fill on hover.
- **Motion:** subtle only: `crtFade` on page load, `fadeInSoft` for revealed content, `blink` for cursors, ≤0.45s. Nothing bouncy or attention-grabbing.
- **Accordions:** use native `<details>/<summary>` styled like `.resource-group`.

### Spacing and layout
- Page padding `32px 16px` (`12px 10px` on phones); frame padding `20px 28px 18px` (`14px 12px 12px` on phones ≤480px).
- Gaps on a small, consistent scale: `6, 8, 10, 12, 14, 16, 18, 24, 32px`. Cards pad `8–12px`; panels pad `24px` (`16px` on phones).
- Mobile-first breakpoints already in use: `480px`, `600px`, `720px`, `900px`. Every page must work down to 320px wide with no sideways scrolling or clipped text. In flex/grid layouts that stack on phones, give text columns `min-width: 0` rather than a fixed minimum width.

### Code conventions
- Shared styles go in `style.css` under the matching `/* === SECTION === */` block; edit an existing rule rather than appending a second copy of the same selector at the bottom. Avoid page-level `<style>` blocks. Respect the ordering notes in `style.css` (e.g. the LINKS block must stay below NAV and LANDING PAGE).
- Every page uses the same header, nav, and footer markup. When the nav changes, update it on **every** page, including `member/*.html`.
- Images need meaningful `alt` text. Compress large images (aim < 500 KB) and use thumbnails for previews.

## Roadmap (in order)

Work these phases in sequence. Each phase is its own set of branches and PRs. Don't start building a later phase's features early.

1. **Design refresh + realistic About-page avatar.** Polish the terminal look within the rules above; clean up duplicated CSS; fix known broken links and filenames. Replace the About page's video-only intro with a realistic avatar of the club that fits the terminal frame.
2. **Backend setup.** Add real authentication (replacing the client-side password gate), a database, and roles: member, moderator, admin. All secrets in environment variables (Rule 2). *Done:* Google sign-in, the `profiles` table with roles, the account page and the moderation page; the old shared-password screen is removed and the home page is public.
3. **Merged Members / Join page.** One page combining the roster and sign-up. Joining creates an account request that moderators approve; approved members manage their own profile. *Done:* `members.html` has the public roster and `join.html` is the request-membership page (split out again on 2026-10-04), which sends people to `account.html`; after Google sign-in they fill in "About you" (`join_details` table, migration 002), which moderators see on `moderate.html`. A new request also emails the organizers through Formspree. Members now manage their own profile (members-only directory, migration 008). The directory shows focus areas and a NEW tag for the first two weeks.
4. **Projects hub.** Members submit projects → moderator review → published. Includes comments on projects and a contact-relay so visitors can message a project's creator without exposing their email. *Built:* submission → moderator review → published, comments, contact by revealing the author's email to members, moderator-only delete. *Added later:* private messages to authors with an inbox (in place of showing emails), and authors editing unpublished items. Email notifications for new inbox messages were added with migration 011. (Decided 2026-10-04: published projects are public and the Collective's tools were moved into the hub.)
5. **Learning Materials.** Folder-organized library that reuses the Projects submission → moderation → publish pipeline (don't build a second one). *Built:* `learn.html` with folders, on the shared projects pipeline (migration 004). The public `resources.html` is unchanged apart from a pointer to it.
6. **Topic-based chat.** Member chat organized by topic/channel, with moderator tools and the no-PHI notice (Rule 3). *Built:* `chat.html` with moderator-managed topics and live messages (migration 005).
7. **Daily AI blog agent.** An agent that drafts a daily AI-in-medicine post, plus an Instagram-ready version and a weekly newsletter roundup. Drafts are human-reviewed before publishing, and the agent's keys live only in server-side secrets. *Built early (doesn't need logins):* draft PRs three times a week (owner chose Mon/Wed/Fri over daily: a daily run found only 1 item at about $1 per run), the Blog page and weekly newsletter drafts (see "Blog agent" above). Still to do: Instagram (no account yet) and automated listserv sending (service not chosen yet).

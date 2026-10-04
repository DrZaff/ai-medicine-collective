# CLAUDE.md — AI Medicine Collective website

Guidance for Claude (and any contributor) working in this repo. Read it fully before making changes.

## Project overview

Club website for the AI Medicine Collective, a group of residents (IM, Med/Peds, EM) building AI tools for medicine.

- **Stack today:** plain static HTML, one shared stylesheet (`style.css`), one shared script (`script.js`), plus `auth.js` (sign-in, account and moderation pages only). No framework. Backend is Supabase (see "Backend" below).
- **Forms:** the Join form posts to Formspree (`https://formspree.io/f/mqaonqpr`).
- **Hosting:** Netlify (site `ai-medicine-collective`, https://ai-medicine-collective.netlify.app), connected to this repo: every PR gets a deploy preview (`deploy-preview-<N>--ai-medicine-collective.netlify.app`) and every merge to `main` publishes to production.
- **Login (phase 2):** Supabase Auth with Google sign-in, members only. The Supabase project and Google client were set up on 2026-10-03 following [docs/auth-setup.md](docs/auth-setup.md).
- **Who sees what (decided):** signed-out visitors see Home, About, Members (names only), Join and the Blog. Everything new (Projects hub, Learning Materials, Chat) is members-only, enforced by database rules rather than hidden pages.
- **Build step:** Netlify runs `python3 scripts/blog_agent/build_index.py` (see `netlify.toml`), which generates `blog/index.json`. That file is gitignored; run the script locally before previewing `blog.html`.

## Backend (Supabase)

- **Project URL:** `https://ahwnarhmuzxgjindreuz.supabase.co`
- **Publishable key (public by design, safe in site code):** `sb_publishable_3C4xXn0j3GiunX-t6cd0HQ_ze_yTErT`
- **Never in the repo or chat:** the secret / `service_role` key, the database password, the Google client secret (Rule 2).
- **Roles** (`public.profiles.role`): `pending` → `member` → `moderator` → `admin`, plus `rejected`. New sign-ins get a `pending` profile automatically. Roles change only through the SQL functions `approve_member`, `reject_member` (moderators) and `set_member_role` (admins), never by editing the column.
- **Tables so far:** `profiles` (001); `join_details` (002: role, program, interests, message; readable by the person and moderators only); `projects` and `project_comments` plus the private storage bucket `project-files` (003); `material_folders` and the `kind`/`folder` columns on `projects` (004); `chat_topics` and `chat_messages` (005). Option lists in `auth.js` and `hub.js` must match the CHECK constraints in the migrations.
- **Database changes are migration files:** add `supabase/migrations/NNN_description.sql` (next number, never edit one that has been run). The owner runs each file once in the Supabase SQL Editor; Claude has no database access and verifies through the public API only.
- **Every new table must:** enable row level security, have explicit policies, and `grant` only what's needed to `authenticated` (the project has "automatically expose new tables" off). Signed-out visitors (`anon`) get no table access. Use `public.is_member()`, `is_moderator()` and `is_admin()` in policies.
- **Sign-in on the site:** `account.html` (Google sign-in, status, display name, sign out) and `moderate.html` (approve/decline requests; admins set roles). Both load the pinned Supabase library (with an integrity hash) and `auth.js`. Other pages only check `localStorage` for the session key to relabel the nav's SIGN IN link as ACCOUNT; that is cosmetic. `auth.js` and `script.js` share one global scope on those two pages, so top-level names must not collide.
- **Projects hub (`hub.html`, `hub.js`):** members submit a project (title, category, description, optional https link, optional file up to 10 MB) → `pending` → a moderator publishes or rejects it (`review_project`) → published projects are visible to approved members, with comments and a "contact the author" button that reveals the author's email. Only moderators can delete projects. Pending submissions also appear on `moderate.html`. Files are private; the page asks Supabase for a short-lived link to open one. The existing public `projects.html` and `appstore.html` are unchanged.
- **Learning Materials (`learn.html`) is the same pipeline, not a second one:** materials are `projects` rows with `kind = 'material'`, a `folder` (from `material_folders`, which moderators can add to) and a type (presentation, module, guide, video, other). `hub.js` serves both pages; the page picks the kind with `data-kind` on `#hub-app`, and everything kind-specific lives in `HUB_KINDS`. Add a third kind there rather than copying the code. Uploads are capped at 25 MB.
- **Topic chat (`chat.html`, `chat.js`):** approved members post in topics; moderators add topics (archive rather than delete) and can delete any message, members their own; messages can't be edited. New messages arrive through Supabase Realtime (`chat_messages` is in the `supabase_realtime` publication), with a 20-second poll as a safety net. Messages load 50 at a time.
- `auth.js`, `hub.js`, `chat.js` and `script.js` share one global scope on the pages that load them, so their top-level names must not collide.
- Members-only means **the data is protected by these rules**. Page files are always public, so never put member content in static HTML.

## Blog agent

- **Flow:** `.github/workflows/blog-draft.yml` runs Monday, Wednesday and Friday mornings. `scripts/blog_agent/agent.py` asks Claude (`claude-opus-5-5`, web search and fetch, structured JSON output, `fallbacks: "default"`) for the last 7 days of AI-in-medical-education news and research (med-ed first, at most two general AI-in-medicine items), then writes `blog/posts/YYYY-MM-DD.json` and opens a PR titled `Blog draft: <date>`. **Merging the PR is the human review that publishes the post**; closing it skips that post.
- **Safeguards in the script:** an item is kept only if its URL appeared in that run's search or fetch results (no invented links). Items covered in the last 21 days are dropped. Dropped items are listed in the PR. The prompt forbids patient information.
- **Weekly newsletter:** `.github/workflows/weekly-newsletter.yml` (Friday afternoons) runs `scripts/blog_agent/newsletter.py`. It reformats the week's merged posts into `newsletter/<date>.html` (email-ready, inline styles) and `.txt`, then opens a PR. It makes no AI call. Sending to the listserv is still manual.
- **Secrets:** only `ANTHROPIC_API_KEY`, stored as a GitHub Actions secret by the owner. Without it, the blog workflow skips quietly. Both workflows also need the setting *Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"*.
- **Testing without the API:** `python scripts/blog_agent/agent.py --fixture sample.json --date YYYY-MM-DD` (see the script's docstring). Never commit test posts.
- **Post files are data, not HTML:** `script.js` renders posts with `textContent` only. Keep it that way, because post text comes from an AI draft.
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
| `--text` | `#00ff66` | All body text, default for everything |
| `--accent` | `#00cc55` | Borders, rules, highlights |
| `--error` | `#ff5555` | Errors only |

Secondary accents, each with **one job only**:
- Cyan `#00e5ff`: link hover, "Instructions" buttons
- Yellow `#ffe600`: "Launch" / primary-action buttons
- Pink `#ff4da6`: "< Back" links and the Join submit button
- Department tags: IM `#00ff66`, Med/Peds `#00ffd5`, EM `#ffb347`

No other hues. No white backgrounds, no light mode, no gradients beyond the subtle dark radial ones.

### Typography
- One font everywhere: `"Courier New", monospace`. No web fonts, no sans-serif.
- Headings and labels are UPPERCASE with letter-spacing `0.08em`; the site headline uses `0.1em`.
- Body text `0.95rem` at line-height `1.4`; notes and secondary text `0.8–0.85rem` at ~0.85 opacity.
- Inputs and buttons are at least `16px` on phones (prevents iOS zoom).

### Terminal-style elements (use these, don't invent new ones)
- **Frame:** all content inside `.terminal-frame`: max-width `900px`, `2px solid var(--accent)` border, green glow `box-shadow: 0 0 25px rgba(0,255,102,0.4)`.
- **Header:** `:: AI MEDICINE COLLECTIVE ::` centered, followed by the shared `.nav` and a `.horizontal-rule`. On phones (≤600px) `script.js` collapses the nav behind a `> MENU [+]` toggle, so **every page must load `script.js`**.
- **Rules:** sections separated by `2px dashed var(--accent)` (`.horizontal-rule`) or `1px dashed` (`.section-divider`).
- **Voice:** captions and notes written as code comments (`// Current roster`); links and prompts prefixed with `>` (`> PASSWORD:`, `> ABOUT`); back links are `< Back`.
- **Footer:** `> echo "BUILDING INTELLIGENT HEALTHCARE TOGETHER"` + blinking `█` cursor, on every page.
- **Glow, not shadow:** hover and focus states add a green `text-shadow` / `box-shadow` glow (e.g. `0 0 8px rgba(0,255,102,0.5)`). No drop shadows, no blur.
- **Boxes and cards:** near-black fill `rgba(0,0,0,0.7–0.85)`, `1px` green border at ~25–40% opacity, brightening to `--accent` on hover. Square corners (`0–4px`); pills (`999px`) only for buttons and tags.
- **Buttons:** transparent background, `1px` colored border, UPPERCASE text, faint tinted fill on hover.
- **Motion:** subtle only: `crtFade` on page load, `fadeInSoft` for revealed content, `blink` for cursors, ≤0.45s. Nothing bouncy or attention-grabbing.
- **Accordions:** use native `<details>/<summary>` styled like `.resource-group`.

### Spacing and layout
- Page padding `16px`; frame padding `24px 20px 16px` (`16px 12px 12px` on phones ≤480px).
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
3. **Merged Members / Join page.** One page combining the roster and sign-up. Joining creates an account request that moderators approve; approved members manage their own profile. *Done:* `members.html` has the public roster plus a `#join` section that sends people to `account.html`; after Google sign-in they fill in "About you" (`join_details` table, migration 002), which moderators see on `moderate.html`. A new request also emails the organizers through Formspree. `join.html` just forwards to `#join`. Still to do: members managing a public profile.
4. **Projects hub.** Members submit projects → moderator review → published. Includes comments on projects and a contact-relay so visitors can message a project's creator without exposing their email. *Built:* submission → moderator review → published, comments, contact by revealing the author's email to members, moderator-only delete. Still to do: the email-hiding contact relay, authors editing their own submissions, and deciding whether published projects should be public and whether the Collective's existing tools move into the hub.
5. **Learning Materials.** Folder-organized library that reuses the Projects submission → moderation → publish pipeline (don't build a second one). *Built:* `learn.html` with folders, on the shared projects pipeline (migration 004). The public `resources.html` is unchanged apart from a pointer to it.
6. **Topic-based chat.** Member chat organized by topic/channel, with moderator tools and the no-PHI notice (Rule 3). *Built:* `chat.html` with moderator-managed topics and live messages (migration 005).
7. **Daily AI blog agent.** An agent that drafts a daily AI-in-medicine post, plus an Instagram-ready version and a weekly newsletter roundup. Drafts are human-reviewed before publishing, and the agent's keys live only in server-side secrets. *Built early (doesn't need logins):* draft PRs three times a week (owner chose Mon/Wed/Fri over daily: a daily run found only 1 item at about $1 per run), the Blog page and weekly newsletter drafts (see "Blog agent" above). Still to do: Instagram (no account yet) and automated listserv sending (service not chosen yet).

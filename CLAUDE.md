# CLAUDE.md — AI Medicine Collective website

Guidance for Claude (and any contributor) working in this repo. Read it fully before making changes.

## Project overview

Club website for the AI Medicine Collective, a group of residents (IM, Med/Peds, EM) building AI tools for medicine.

- **Stack today:** plain static HTML, one shared stylesheet (`style.css`), one shared script (`script.js`). No framework, no build step, no backend.
- **Forms:** the Join form posts to Formspree (`https://formspree.io/f/mqaonqpr`).
- **Hosting:** not determined from the repo (GitHub Pages is off). Confirm with the owner before changing anything deployment-related.
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
- Client-side code is public. Anything in HTML/JS (e.g. the current password gate in `script.js`) is visible to everyone and is **not** security.

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
2. **Backend setup.** Add real authentication (replacing the client-side password gate), a database, and roles: member, moderator, admin. All secrets in environment variables (Rule 2).
3. **Merged Members / Join page.** One page combining the roster and sign-up. Joining creates an account request that moderators approve; approved members manage their own profile.
4. **Projects hub.** Members submit projects → moderator review → published. Includes comments on projects and a contact-relay so visitors can message a project's creator without exposing their email.
5. **Learning Materials.** Folder-organized library that reuses the Projects submission → moderation → publish pipeline (don't build a second one).
6. **Topic-based chat.** Member chat organized by topic/channel, with moderator tools and the no-PHI notice (Rule 3).
7. **Daily AI blog agent.** An agent that drafts a daily AI-in-medicine post, plus an Instagram-ready version and a weekly newsletter roundup. Drafts are human-reviewed before publishing, and the agent's keys live only in server-side secrets.

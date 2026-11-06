# Repository audit: readiness for agent development

Audited 2026-11-06 at commit `549129b` (main). The site is in good shape for agents: it already has clear written rules (CLAUDE.md), a pull-request-only workflow and Netlify previews. The gaps are automated checks on pull requests (added in this change) and a few automations that act on merge, which agents must not trigger by accident.

## Current architecture

| Part | What it is | Where |
| --- | --- | --- |
| Website | Plain HTML, `style.css` + `modern.css` (two themes), shared scripts, no framework | repo root |
| Hosting | Netlify; every PR gets a deploy preview, every merge to `main` goes to production | `netlify.toml` |
| Build | `build_index.py` generates `blog/index.json` (gitignored) | `scripts/blog_agent/` |
| Backend | Supabase: Auth (Google, email and password), Postgres with row-level security, storage, Realtime | `supabase/migrations/` (run by hand by the owner) |
| Email | Resend, from the database (`pg_net`) and from workflows (`notify.py`) | migrations 011, 013, 016, 017 |
| Scheduling | GitHub cron plus `pg_cron` in the database pressing "Run workflow" (migration 018) | `.github/workflows/`, migration 018 |
| Content agents | Python scripts calling the Anthropic API; their output arrives as pull requests | `scripts/blog_agent/` |
| Bot protection | Cloudflare Turnstile on sign-in forms | `auth.js` |

## Automations that must be preserved

| Workflow | Trigger | Writes | Note for agents |
| --- | --- | --- | --- |
| `blog-draft.yml` | Mon/Wed/Fri cron, `pg_cron`, by hand | branch `blog/<date>`, PR, emails | Owns the `blog/` branch prefix |
| `living-review.yml` | 1st of the month, by hand | branch `review/ai-vs-human-<date>`, PR | Owns the `review/` prefix |
| `instagram-publish.yml` | push to `main` that **adds** `social/*/caption.txt` | posts to Instagram | An agent PR that adds a caption would post on merge |
| `instagram-token.yml` | Mondays | the `IG_ACCESS_TOKEN` secret | Uses `SECRETS_WRITE_TOKEN`, which can write repo secrets |
| `weekly-newsletter.yml` | Friday cron, push of `blog/posts/*.json` | **commits straight to `main`** | The one direct-push exception; branch protection must allow it |
| `test-email.yml` | by hand | one email | Harmless |

Also preserved: the Netlify deploy previews, the `pg_cron` jobs, and the human review step of merging blog and evidence PRs.

## Missing tests and quality checks

1. **No checks ran on pull requests.** The Netlify preview was the only gate. *Fixed here:* `site-checks.yml` with a static check and a browser smoke test, both read-only. Both pass on the current site (verified locally: 40 HTML files, 24 top-level pages × 2 themes × 2 widths, no errors).
2. **Bot pull requests get no checks.** PRs opened with the default `GITHUB_TOKEN` (blog drafts, living review) don't start workflows. A GitHub App token for the bots would fix it; left for the owner to decide.
3. **No tests for the Python agents** beyond their `--fixture` modes. Next step: run each fixture mode in CI.
4. **No database tests.** Row-level security is reviewed by reading migrations only. A local Supabase with pgTAP tests is possible later; until then every migration PR needs a human security read.
5. **No signed-in tests.** The smoke test covers signed-out pages only. Signed-in tests need a test Supabase project with synthetic members; don't point tests at production.
6. **Limits of the new checks.** The secret scan is a set of patterns, not a full scanner; GitHub's own secret scanning should also be on. The browser test covers signed-out pages only. Neither check says anything about clinical correctness, which is the clinician's job (architecture.md, "Risk tiers"). Stronger checks come before higher-risk automation.
7. **No dependency updates.** Actions are pinned by tag (`@v4`), not by commit; Python packages are pinned. Dependabot for Actions and pip is a low-risk next step.

## Security and deployment risks

1. **Merging is deploying.** Every merge to `main` goes to production, can post to Instagram, and can rebuild the digest. Agents must never merge; branch protection should enforce it.
2. **Branch protection is not visible from the code.** Recommended: a ruleset requiring a pull request, one approving review and code-owner review on `main`, and blocking force pushes. **Don't** bypass for `github-actions[bot]`: a bypass applies to every workflow running as that actor. Move the weekly digest's direct push onto a dedicated GitHub App, the only bypass actor, whose key only `main` deployments can read (architecture.md, "Security boundaries").
3. **The repository is public.** Issues, PRs, logs and agent comments are public. Task descriptions must never carry patient information or secrets.
4. **Prompt injection through issues.** Anyone can open an issue or comment. Only issues the owner labels `agent:ready` become tasks, and the orchestrator must check who applied the label.
5. **Workflow files are powerful.** A changed workflow can read secrets once merged. Recommended: CODEOWNERS on `.github/` so those changes always need the owner.
6. **Migrations can weaken access rules.** An agent-written migration could widen a policy or `grant`. The owner runs migrations by hand, which is the right gate; every migration PR needs a security read against the CLAUDE.md checklist.
7. **`SECRETS_WRITE_TOKEN`** can write any repository secret. Keep it scoped to this repository and never expose it to agent jobs.
8. **Medical content.** Tool logic, scores and evidence text can affect care. They need a clinician's review (the `needs-clinical-review` label).

## Requirements for Claude Code and Codex

- Claude Code reads `CLAUDE.md`; Codex reads `AGENTS.md`. AGENTS.md points to CLAUDE.md as the authority and adds only agent-specific rules, so the two never drift apart.
- Both need the same check commands (`scripts/checks/`), which this change adds.
- Each agent needs its own GitHub identity (a fine-grained token or a GitHub App) with pull request and issue access only: no admin and no secrets access.
- Agent spending must be separate from the content agents' `ANTHROPIC_API_KEY`, so a runaway task can't use up the blog's budget.

## Conflicts between existing automations and agents

| Conflict | Resolution |
| --- | --- |
| Branch names | Agents use `agent/<issue>-<name>`; `blog/` and `review/` stay with the bots |
| Instagram posting on merge | Agents never add `social/*/caption.txt` (AGENTS.md) |
| Digest job pushing to `main` | Agents don't edit `newsletter/`; rebase agent branches before review; the push moves to a dedicated GitHub App before the ruleset is on |
| `blog/editorial-queue.json` | Edited by people (and Claude on request) and read by the blog agent; agents edit it only when an issue asks |
| Netlify build minutes | Each PR push builds a preview. Keep agent PRs as drafts and push in batches; watch the monthly build-minute allowance |
| Emails that say "tell Claude 'merge it'" | Fine in a conversation with the owner; unattended agents never merge |

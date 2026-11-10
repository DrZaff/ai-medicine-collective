# Billy: the agents' GitHub identity

Billy is the GitHub App that publishes agent work, the "orchestrator credential" in [architecture.md](architecture.md). It runs on the owner's Linux server (`billy`) as the unprivileged `agent` user. Status: **supervised pilot**. Everything is launched by hand; nothing runs on a timer.

## The app

- Private app **Billy - AI Medicine Collective**, App ID 5691222, installation 180393253.
- Installed on `DrZaff/ai-medicine-collective` only, with Contents (read and write), Pull requests (read and write) and Metadata (read). No Issues, Administration, Workflows or Secrets permission.
- Its PRs and commits appear as `billy-ai-medicine-collective[bot]`, so the owner can approve them.

## On the server (outside this repository)

| Path (under `/home/agent`) | What | Mode |
| --- | --- | --- |
| `.config/billy/app.pem` | the app's private key | `600` |
| `.config/billy/app.json` | `app_id` and `installation_id` (not secret) | `600` |
| `.local/lib/billy/preflight.py` | checks the app, installation, exact permissions and one-repository scope, then revokes its token | `700` |
| `.local/lib/billy/pr_test.py`, `handoff.py`, `review-schema.json` | copies of the files in `scripts/billy/`, installed by hash | `600` |
| `.local/state/billy/runs/` | one JSON record per handoff run (verdict, findings, PR link; no secrets) | `700` |

Each run turns the key into a token that lasts at most an hour, is limited to this repository and the three permissions, is never printed, and is revoked when the run ends. Tailscale on the server is the snap package: receive Taildrop files into `/var/snap/tailscale/common/inbox`, not a folder under a home directory.

## The handoff: Claude builds, Codex reviews, Billy publishes

GitHub carries the work between the three; nothing is copied by hand.

1. **Claude builds** on a branch named `claude/...` or `agent/...` and reports the branch and the full commit SHA.
2. **The owner launches** one run in a terminal on the server:
   ```sh
   sudo -iu agent python3 ~/.local/lib/billy/handoff.py <branch> <commit-sha> [--issue N]
   ```
   It refuses to start without a terminal, so it can't be put on a timer by accident.
3. **Codex reviews the exact commit.** The script clones the repository without credentials, stops unless the branch is at exactly that commit, and runs `codex exec` in a read-only sandbox on the diff against `main`. The report follows `review-schema.json`: each finding with severity, file and line, problem, reproduction, confidence and fix, and a verdict.
4. **Billy publishes only after a passing review.** With *no blocking findings*, Billy pushes that same commit to a new branch `agent/[<issue>-]<name>-<sha7>` and opens a **draft** PR into `main` whose description carries the report. With blocking findings, nothing is pushed.
5. **Stop for the owner.** The owner reviews, approves and merges on GitHub. Billy never merges, never pushes to `main`, never force-pushes and never reuses a branch. A new commit means a new run and a new approval.

The Codex review is a report, not a GitHub approval, so it can never satisfy the human-approval rule.

## Working together

GitHub is the shared record. Each party reads it before acting, and nothing passes between them by copy and paste except what the owner chooses to relay.

| Who | Reads | Writes |
| --- | --- | --- |
| Claude (builder, cloud sessions) | issues, PRs and their review reports, this page | commits on `claude/...` branches; reports the branch and full commit SHA to the owner |
| Codex (reviewer, on the server as `agent`) | the exact commit it is given, CLAUDE.md, AGENTS.md, this page | the structured review report, which Billy puts in the PR description |
| Billy (publisher) | nothing it decides on: it runs the steps above | the `agent/...` branch and the draft PR |
| Owner | everything | approvals, merges, rulesets, the server |

- **Findings go back as a new commit.** Claude fixes Codex's findings on the same `claude/...` branch; the owner launches a fresh run on the new SHA. Billy opens a new PR for it (it never reuses a branch); close the superseded one.
- **Questions go in the report.** If Codex needs something from Claude or the owner, it says so as a `note` finding. Claude reads PRs and their reports when the owner points it at one.
- **In an interactive session on the server, Codex keeps to the setup:** it may read, check and explain; it does not edit `scripts/billy/` copies in place (changes come through this repository and are installed by hash), print or copy the key or tokens, enable rulesets, touch Netlify, or schedule anything.
- **Claude** has no access to the server; every server step is a command the owner runs and pastes back.

## Verified (2026-11-10)

| Check | Result |
| --- | --- |
| Preflight: identity, exact permissions, one-repository token, revocation | Passed |
| Billy pushes a branch and opens a PR as the app | Passed (#154, #155) |
| With a ruleset requiring a PR and 1 approval: direct push, merge before approval and branch deletion are refused | Passed on `billy-test/protected-target` (ruleset 26928012, PR #155): "Changes must be made through a pull request.", HTTP 405 "New changes require approval from someone other than the last pusher.", "Cannot delete this branch" |

## Remaining setup

| Step | Who | State |
| --- | --- | --- |
| Confirm the app reaches no other repository (GitHub > Settings > Applications > Billy > Configure) | Owner | Open |
| First supervised handoff run, end to end | Owner launches; Codex reviews; Billy opens the draft PR | Open |
| Check that Site checks start on Billy's PRs (an app token, unlike `GITHUB_TOKEN`, should start them) | Owner, on that PR | Open |
| Review the two `main` rulesets against [dell-setup.md](dell-setup.md) A.4 before enabling them; Billy must not be on a bypass list | Owner | Open; both stay **disabled** until the owner decides |
| Remove the test ruleset and the `billy-test/*` branches; close test PR #155 | Owner | After the negative test (passed on #155) |
| Tighten `/home/agent/.codex` to mode `700` (it is `755`) | Owner | Open |

Not part of the pilot: unattended runs, timers, issue labels (Billy has no Issues permission), Netlify production publishing (stays locked), and anything in architecture.md's sandbox and credential sections, which apply before any unattended run.

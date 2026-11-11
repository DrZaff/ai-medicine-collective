# Billy: the agents' GitHub identity

Billy is the GitHub App that publishes agent work, the "orchestrator credential" in [architecture.md](architecture.md). It runs on the owner's Linux server (`billy`). Status: **supervised pilot**. Everything is launched by hand; nothing runs on a timer.

## The app

- Private app **Billy - AI Medicine Collective**, App ID 5691222, installation 180393253.
- Installed on `DrZaff/ai-medicine-collective` only, with Contents (read and write), Pull requests (read and write) and Metadata (read). No Issues, Administration, Workflows or Secrets permission.
- Its PRs and commits appear as `billy-ai-medicine-collective[bot]`, so the owner can approve them.

## On the server (outside this repository)

Two Unix users, so the reviewer can never read the publisher's key (the first handoff review, 2026-11-10, found that a read-only sandbox stops writes, not reads):

| User | Holds | Runs | Can't |
| --- | --- | --- | --- |
| `agent` | the Codex sign-in (`/home/agent/.codex`, mode `700`) | the **review** step (Codex) | read Billy's key |
| `billy-pub` (system user, no login) | Billy's key and IDs in `/var/lib/billy-pub/.config/billy/` (`app.pem`, `app.json`, mode `600`) | `preflight.py`, `pr_test.py` and the **publish** step | run Codex or repository code |

| Path | What |
| --- | --- |
| `/opt/billy/` (root-owned, read-only to both users) | `preflight.py`, `pr_test.py`, `handoff.py`, `review-schema.json`: the files in `scripts/billy/`, installed by hash with `install.sh` |
| `/var/lib/billy-reviews/` (`agent` writes, `billy-pub` reads) | one review record per commit |
| `~/.local/state/billy/runs/` of each user | a JSON record per step (verdict, findings, PR link; no secrets) |

Each publishing step turns the key into a token that lasts at most an hour, is limited to this repository and the three permissions, is never printed, and is revoked when the step ends. Tailscale on the server is the snap package: receive Taildrop files into `/var/snap/tailscale/common/inbox`, not a folder under a home directory. Codex for `agent` is installed through nvm, so its node folder goes on PATH in the launch command.

## The handoff: Claude builds, Codex reviews, Billy publishes

GitHub carries the work between the three; nothing is copied by hand. How a task gets here, from an issue written with ChatGPT's help to the owner's merge, is in [handoff.md](handoff.md).

1. **Claude builds** on a branch named `claude/...` or `agent/...`, runs the AGENTS.md checks, puts their results in the commit message, and reports the branch and the full commit SHA. (The server runs no repository code until the sandbox in architecture.md exists, so these checks run where Claude builds, and again as Site checks on the PR.)
2. **The owner launches** both steps in a terminal on the server (each refuses to start without one, so neither can be put on a timer by accident):
   ```sh
   N=/home/agent/.nvm/versions/node/v26.13.0/bin; cd /tmp && \
   sudo -H -u agent env PATH="$N:/usr/local/bin:/usr/bin:/bin" python3 /opt/billy/handoff.py review <branch> <sha> && \
   sudo -H -u billy-pub python3 /opt/billy/handoff.py publish <branch> <sha> [--issue N]
   ```
3. **Codex reviews the exact commit** (`review`, as `agent`). The script refuses to start if it can read Billy's key, clones without credentials, stops unless the branch is at exactly that commit, and runs `codex exec` in a read-only sandbox on the diff against `main`. A report containing anything key- or token-shaped is neither printed nor saved, and the run stops. The report follows `review-schema.json` (each finding with severity, file and line, problem, reproduction, confidence and fix, and a verdict) and is recorded for that commit.
4. **Billy publishes only after a passing review** (`publish`, as `billy-pub`). It re-clones on its own, re-checks the commit, and requires a passing record for exactly that commit, less than an hour old. It refuses any PR text containing something key- or token-shaped. Then it pushes that same commit to a **new** branch `agent/[<issue>-]<name>-<sha7>` (GitHub refuses the push if the branch already exists) and opens a **draft** PR into `main` carrying the report. If the PR's head is not the reviewed commit, the step fails and says not to approve it. With blocking findings, nothing is pushed.
5. **Stop for the owner.** The PR stays a draft until Site checks pass. The owner reviews, approves and merges on GitHub. Billy never merges, never pushes to `main`, never force-pushes over a branch and never reuses one. A new commit means a new run and a new approval.

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
- **In an interactive session on the server, Codex keeps to the setup:** it may read, check and explain; it does not change `/opt/billy` (changes come through this repository and are installed by hash with `install.sh`), try to read `/var/lib/billy-pub`, print or copy the key or tokens, enable rulesets, touch Netlify, or schedule anything.
- **Claude** has no access to the server; every server step is a command the owner runs and pastes back.

## Verified (2026-11-10)

| Check | Result |
| --- | --- |
| Preflight: identity, exact permissions, one-repository token, revocation | Passed |
| Billy pushes a branch and opens a PR as the app | Passed (#154, #155) |
| Codex blocks publication on a blocking finding | Passed (review of `f89810c`; nothing pushed) |
| Key isolation: `agent` cannot read the key after `install.sh` | Passed (`agent_cannot_read_key=yes`) |
| End to end: Codex review of the exact commit, then Billy's draft PR into `main` | Passed (#156, head = reviewed commit `42e73de`); Site checks started on Billy's PR and passed |
| With a ruleset requiring a PR and 1 approval: direct push, merge before approval and branch deletion are refused | Passed on `billy-test/protected-target` (ruleset 26928012, PR #155): "Changes must be made through a pull request.", HTTP 405 "New changes require approval from someone other than the last pusher.", "Cannot delete this branch" |

## Remaining setup

| Step | Who | State |
| --- | --- | --- |
| Confirm the app reaches no other repository (GitHub > Settings > Applications > Billy > Configure) | Owner | Open |
| Every Codex finding from the setup reviews (#156, #157, #158) | Claude builds; Codex reviews; owner merges | Done (#166: no findings) |
| Test ruleset, `billy-test/*` branches and test PRs | Owner | Removed 2026-11-11 |
| Both `main` rulesets: owner on each bypass list (pull requests only), Billy on neither, CodeQL rule removed | Owner | Done; both stay **disabled** until the owner decides |
| Digest publisher app on both `main` rulesets' bypass lists (mode Always), before enabling them | Owner | Open: steps at the top of `.github/workflows/weekly-newsletter.yml` |

Not part of the pilot: unattended runs, timers, issue labels (Billy has no Issues permission), Netlify production publishing (stays locked), and anything in architecture.md's sandbox and credential sections, which apply before any unattended run.

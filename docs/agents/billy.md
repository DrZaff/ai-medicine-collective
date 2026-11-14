# Billy: the agents' GitHub identity

Billy is the GitHub App that publishes agent work, the "orchestrator credential" in [architecture.md](architecture.md). It runs on the owner's Linux server (`billy`). Status: **supervised pilot**. Everything is launched by hand; nothing runs on a timer.

## The app

- Private app **Billy - AI Medicine Collective**, App ID 5691222, installation 180393253.
- Installed on `DrZaff/ai-medicine-collective` and, from Mission Control's step A0, the private `DrZaff/billy-mission-control` (after that repository's ruleset is active), and nothing else, with Contents (read and write), Pull requests (read and write) and Metadata (read). No Issues, Administration, Workflows or Secrets permission.
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
| `/var/lib/billy-sources/` (`billy-pub` writes, `agent` reads) | a git bundle of a private repository's commit, for the reviewer |
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
3. **Codex reviews the exact commit** (`review`, as `agent`). For a **private** repository (`--repo billy-mission-control`), a `fetch` step runs first as `billy-pub`. It uses a read-only token for that one repository, revoked straight after, and writes a git bundle of the exact commit to `/var/lib/billy-sources`. The review then clones from that bundle, after checking it is for that repository, branch and commit and under an hour old, so the reviewer still never holds a credential. Where Billy isn't installed on the private repository, the owner carries a bundle instead: `fetch --bundle FILE --main <main's full SHA>` imports it with no token, after checking that both the branch and `main` are at the commits named. The review diffs against `main`, so a wrong `main` could hide part of a change. Billy can't publish there; Claude opens the PR, and its head must be the reviewed commit. Billy works only on the repositories listed in `REPOS` in `handoff.py`. The script refuses to start if it can read Billy's key, clones a public repository without credentials, stops unless the branch is at exactly that commit, and runs `codex exec` in a read-only sandbox on the diff against `main`. A report containing anything key- or token-shaped is neither printed nor saved, and the run stops. The report follows `review-schema.json` (each finding with severity, file and line, problem, reproduction, confidence and fix, and a verdict) and is recorded for that commit.
4. **Billy publishes only after a passing review** (`publish`, as `billy-pub`). It re-clones on its own, re-checks the commit, and requires a passing record for exactly that commit, less than an hour old. It refuses any PR text containing something key- or token-shaped. Then it pushes that same commit to a **new** branch `agent/[<issue>-]<name>-<sha7>` (GitHub refuses the push if the branch already exists) and opens a **draft** PR into `main` carrying the report. If the PR's head is not the reviewed commit, the step fails and says not to approve it. With blocking findings, nothing is pushed.
5. **Stop for the owner.** The PR stays a draft until Site checks pass. The owner reviews, approves and merges on GitHub. The publish step ends by printing the **sign-off steps with exact links**: Ready for review, then the Files changed tab to approve, then the merge box. The same steps, without links, are in the PR description.

   **Why the bypass box.** Because ruleset 26914500 restricts updates to `main`, the owner's merge always goes through the pull-request bypass ("Merge without waiting for requirements to be met"), even when every requirement is met. That rule is what stops Billy's app from merging a PR the owner has approved. The box also skips failing checks, so tick it only when the merge box shows **Changes approved** and **All checks have passed**, and the one line left is "Cannot update this protected ref". Billy never merges, never pushes to `main`, never force-pushes over a branch and never reuses one. A new commit means a new run and a new approval.

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

## Verified against the live `main` ruleset (2026-11-14)

"Main - Owner Merge Only" (26914500) was **Active** on `main`. To test Billy against its real rules and bypass list without risking `main`, the owner added `billy-test/protected-target` as a second target of that same ruleset for the test, then removed it. GitHub's rules endpoint showed the test branch with exactly `main`'s five rules, all from 26914500 (`deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`, `update`). `pr_test.py` only pushes to `billy-test/` branches and refuses force pushes, so a failure could only have changed the disposable branch.

| Step | Result |
| --- | --- |
| Installed scripts match the repository (`sha256sum /opt/billy/preflight.py /opt/billy/pr_test.py`) | Matched (`2e0bb166…`, `1aa70c7a…`) |
| `preflight.py` | Passed; token revoked |
| `pr_test.py setup`: target branch from `main`, dev branch, PR as `billy-ai-medicine-collective[bot]` | Passed (PR #194) |
| `pr_test.py negative`: Billy pushes directly to the protected branch | **Refused**: "2 of 2 required status checks are expected" |
| `pr_test.py negative`: Billy merges unapproved PR #194 | **Refused**: "Cannot update this protected ref", "Waiting on code owner review from DrZaff" |
| `pr_test.py negative`: Billy deletes the protected branch | **Refused**: "Cannot delete this branch" |
| Clean-up | Test target removed from the ruleset, PR #194 closed unmerged, both `billy-test/*` branches deleted |
| Repository unchanged | `main` at `06ec2a7` before and after, with no push to it during the test; its five rules still in force |

This shows Billy is not on 26914500's bypass list and cannot push to, merge into or delete `main`. It does not cover a clinician's approval for clinical files: CODEOWNERS lists no clinical paths yet ([architecture.md](architecture.md)).

## Remaining setup

| Step | Who | State |
| --- | --- | --- |
| Confirm the app reaches no other repository (GitHub > Settings > Applications > Billy > Configure) | Owner | Open |
| Every Codex finding from the setup reviews (#156, #157, #158) | Claude builds; Codex reviews; owner merges | Done (#166: no findings) |
| Test ruleset, `billy-test/*` branches and test PRs | Owner | Removed 2026-11-11 |
| Both `main` rulesets: owner on each bypass list (pull requests only), Billy on neither, CodeQL rule removed | Owner | Done. "Main - Owner Merge Only" (26914500) is **Active** (2026-11-14); "Protect Main - Human Approval Required" (26913560) stays disabled |
| Digest publisher app, then turning on protection for `main` | Owner | Ruleset on and Billy's negative test passed (above). Still open: the owner's own checks and the first Friday digest push under the ruleset; see phase 4 in [digest-publisher.md](digest-publisher.md) |

Not part of the pilot: unattended runs, timers, issue labels (Billy has no Issues permission), Netlify settings (production auto-publishing was unlocked by the owner on 2026-11-14), and anything in architecture.md's sandbox and credential sections, which apply before any unattended run.

# Billy: the agents' GitHub identity

Billy is the GitHub App that publishes agent work, the "orchestrator credential" in [architecture.md](architecture.md). It runs on the owner's Linux server (`billy`). Status: **supervised pilot**. Everything is launched by hand; nothing runs on a timer.

## The app

- Private app **Billy - AI Medicine Collective**, App ID 5691222, installation 180393253.
- Installed on `DrZaff/ai-medicine-collective` only. It is **not** installed on `DrZaff/billy-mission-control` (public since 2026-11-14), whose commits Codex reviews with `--repo billy-mission-control` and whose PRs Claude opens. Its permissions are with Contents (read and write), Pull requests (read and write) and Metadata (read). No Issues, Administration, Workflows or Secrets permission.
- Its PRs and commits appear as `billy-ai-medicine-collective[bot]`, so the owner can approve them.

## On the server (outside this repository)

Two Unix users, so the reviewer can never read the publisher's key (the first handoff review, 2026-11-10, found that a read-only sandbox stops writes, not reads):

| User | Holds | Runs | Can't |
| --- | --- | --- | --- |
| `agent` | the Codex sign-in (`/home/agent/.codex`, mode `700`) | the **review** step (Codex) | read Billy's key |
| `billy-pub` (system user, no login) | Billy's key and IDs in `/var/lib/billy-pub/.config/billy/` (`app.pem`, `app.json`, mode `600`) | `preflight.py`, `pr_test.py` and the **publish** step | run Codex or repository code |
| `billy-stop` (system user, no login) | the control folder `/var/lib/billy-control/` | Mission Control's stop helper (`billy-stop.service`, since A4c): it only ever **sets** the stop marker | clear the marker in normal use, or read anything of Billy's |
| `mission-control` (system user, no login) | Mission Control's sign-in and events databases in `/var/lib/mission-control/` (mode `700`) | the Mission Control web app (`mission-control.service`, since A4c) | read Billy's key or the Codex sign-in, or set the marker except by asking the stop helper |

| Path | What |
| --- | --- |
| `/opt/billy/` (root-owned, read-only to both users) | `preflight.py`, `pr_test.py`, `handoff.py`, `review-schema.json`: the files in `scripts/billy/`, installed by hash with `install.sh` |
| `/var/lib/billy-reviews/` (`agent` writes, `billy-pub` reads) | one review record per commit |
| `/var/lib/billy-sources/` (`billy-pub` writes, `agent` reads) | a git bundle of a private repository's commit, for the reviewer |
| `~/.local/state/billy/runs/` of each user | a JSON record per step (verdict, findings, PR link; no secrets) |
| `/var/lib/billy-control/` (`billy-stop` writes, everyone reads) | the stop marker `STOP`, when it is set |
| `/var/lib/billy-runs/agent/` and `/var/lib/billy-runs/billy-pub/` (each writer its own, mode `2750`; group `billy-runs` reads) | a read-only copy of each run record, for Mission Control's fetcher (issue #228). Only members of `billy-runs` can read them, and only the fetcher joins it (A5a). Neither writer can touch the other's. |

Each publishing step turns the key into a token that lasts at most an hour, is limited to this repository and the three permissions, is never printed, and is revoked when the step ends. Tailscale on the server is the official apt package from pkgs.tailscale.com (since 2026-11-21; it replaced the snap, which was too old and too confined to serve a Unix socket), with the same machine identity. Receive Taildrop files with `sudo tailscale file get`, followed by the folder to put them in. Codex for `agent` is installed through nvm, so its node folder goes on PATH in the launch command.

## The handoff: Claude builds, Codex reviews, Billy publishes

GitHub carries the work between the three; nothing is copied by hand. How a task gets here, from an issue written with ChatGPT's help to the owner's merge, is in [handoff.md](handoff.md).

1. **Claude builds** on a branch named `claude/...` or `agent/...`, runs the AGENTS.md checks, puts their results in the commit message, and reports the branch and the full commit SHA. (The server runs no repository code until the sandbox in architecture.md exists, so these checks run where Claude builds, and again as Site checks on the PR.)
2. **The owner launches** both steps in a terminal on the server (each refuses to start without one, so neither can be put on a timer by accident):
   ```sh
   N=/home/agent/.nvm/versions/node/v26.13.0/bin; cd /tmp && \
   sudo -H -u agent env PATH="$N:/usr/local/bin:/usr/bin:/bin" python3 /opt/billy/handoff.py review <branch> <sha> && \
   sudo -H -u billy-pub python3 /opt/billy/handoff.py publish <branch> <sha> [--issue N]
   ```
3. **Codex reviews the exact commit** (`review`, as `agent`). For a **private** repository listed in `REPOS` (none at present; `billy-mission-control` became public on 2026-11-14), a `fetch` step runs first as `billy-pub`. It uses a read-only token for that one repository, revoked straight after, and writes a git bundle of the exact commit to `/var/lib/billy-sources`. The review then clones from that bundle, after checking it is for that repository, branch and commit and under an hour old, so the reviewer still never holds a credential. Where Billy isn't installed on the private repository, the owner carries a bundle instead: `fetch --bundle FILE --main <main's full SHA>` imports it with no token, after checking that both the branch and `main` are at the commits named. The review diffs against `main`, so a wrong `main` could hide part of a change, and this host can't read the private repository to check it. **The owner therefore copies `main`'s SHA from GitHub themself, never from the builder who made the bundle.** The step also prints how many files the review covers. Before merging, the PR's **Files changed** count on GitHub, which is computed against the real `main`, must be the same. Billy can't publish there; Claude opens the PR, and its head must be the reviewed commit. Billy works only on the repositories listed in `REPOS` in `handoff.py`. The script refuses to start if it can read Billy's key, clones a public repository without credentials, stops unless the branch is at exactly that commit, and runs `codex exec` in a read-only sandbox on the diff against `main`. A report containing anything key- or token-shaped is neither printed nor saved, and the run stops. The report follows `review-schema.json` (each finding with severity, file and line, problem, reproduction, confidence and fix, and a verdict) and is recorded for that commit.
4. **Billy publishes only after a passing review** (`publish`, as `billy-pub`). It re-clones on its own, re-checks the commit, and requires a passing record for exactly that commit, less than an hour old. It refuses any PR text containing something key- or token-shaped. Then it pushes that same commit to a **new** branch `agent/[<issue>-]<name>-<sha7>` (GitHub refuses the push if the branch already exists) and opens a **draft** PR into `main` carrying the report. If the PR's head is not the reviewed commit, the step fails and says not to approve it. With blocking findings, nothing is pushed.
5. **Stop for the owner.** The PR stays a draft until Site checks pass. The owner reviews, approves and merges on GitHub. The publish step ends by printing the **sign-off steps with exact links**: Ready for review, then the Files changed tab to approve, then the merge box. On an iPhone, GitHub's mobile site hides the approve button, so the steps also say where it is in the GitHub app, and how to reach it in Safari (**aA** > **Request Desktop Website**). The same steps, without links, are in the PR description.

   **Why the bypass box.** Because ruleset 26914500 restricts updates to `main`, the owner's merge always goes through the pull-request bypass ("Merge without waiting for requirements to be met"), even when every requirement is met. That rule is what stops Billy's app from merging a PR the owner has approved. The box also skips failing checks, so tick it only when the merge box shows **Changes approved** and **All checks have passed**, and the one line left is "Cannot update this protected ref". Billy never merges, never pushes to `main`, never force-pushes over a branch and never reuses one. A new commit means a new run and a new approval.

The Codex review is a report, not a GitHub approval, so it can never satisfy the human-approval rule.

## The stop marker

While `/var/lib/billy-control/STOP` exists, **Billy refuses new review and publish steps** (issue #205):

- `handoff.py review`, `fetch` and `publish`, `preflight.py` and `pr_test.py` all refuse at the start, with `STOP: Billy is stopped: …` and exit code **3**. A refusal writes no run record.
- **Mid-step:**
  - `review` checks again before it records a verdict.
  - `fetch` checks again before it mints a token.
  - `publish` checks again before the key is used, before the push, and before it opens the pull request. A token already minted is still revoked. If the marker appears after the push, the step names the pushed `agent/` branch, which the owner deletes on GitHub.
- **Every doubt counts as stopped:**
  - a `STOP` that is a file, a folder or a symlink, even a dangling one (never followed)
  - a missing or unreadable control folder
  - a control folder not owned by `billy-stop`, or writable by others
  - an unprotected folder above it

**What it does not stop:** a Codex review or publish step already past its last check, Claude or Codex sessions, cloud agents and GitHub Actions. It stops *new* Billy steps; it cancels nothing already running.

**Owner commands on the server:**

```sh
sudo -u billy-stop touch /var/lib/billy-control/STOP && sync   # set: Billy refuses every step
ls -l /var/lib/billy-control/                                   # check: STOP listed = stopped
sudo rm /var/lib/billy-control/STOP                             # clear: only after finding out why it was set
```

Setting it by hand is also the way to stop Billy if Mission Control's button is unavailable. `agent` and `billy-pub` can read the folder but not change it: `install.sh` proves this and prints `stop_marker_protected=yes`. It also prints the marker's state and the SHA-256 of every installed file, to compare with the merged commit.

## Shared run records (for Mission Control)

Each step's run record is also copied to `/var/lib/billy-runs/<user>/`, so Mission Control can show Billy's real runs (issue #228, phase A5):

- **What's copied: only checked, structured fields.** The step, repository, SHAs, verdict, each finding's severity, PR link, times and file count. Each one is checked against its expected form, and anything else is dropped. Nothing a person or model chose as text leaves: not Codex's summary or a finding's problem or fix, and not branch names, which a character rule can't keep a credential out of. A secret in a format the filter doesn't know therefore has nowhere to ride. Mission Control gets branch names from GitHub itself, and ties each run to its PR by commit SHA and PR number. The private record under `~/.local/state/billy/runs/` keeps everything.
- **How it's written:** whole and then renamed, so a reader never sees half a record, and never through a symlink.
- **Best effort:** a copy that can't be written (the folder is missing, say) never fails or blocks a step, and the step prints a `WARNING` saying so. The stop marker is checked exactly as before.

**What `install.sh` proves, and prints `shared_runs_protected=yes` and `mission_control_cannot_read_key=yes` for:**

- **The writers:** `agent` and `billy-pub` can each add files only to their own folder, not to the other's or the parent.
- **The group:** neither writer, nor Mission Control's web app account, is in `billy-runs`.
- **The readers:** `billy-runs` holds exactly the accounts named in `READERS` in `install.sh`, counting accounts whose primary group it is. `READERS` is empty until Mission Control's fetcher exists, and its phase A5a adds that one account. Each reader must list both folders and open a probe record in each, written as Billy writes one, and can change nothing there.
- **The secrets:** Mission Control's accounts, and every allowed reader, can read neither the publisher's key nor the Codex sign-in, and can't enter the Codex folder.
- **No ACLs:** no ACL is allowed anywhere in the shared folders (`ls` marks one with `+`), so the plain permission bits alone say who can get in: the writer, and `billy-runs`, which holds only the `READERS`. If one is found, the install stops and names it; remove it with `setfacl -b`.
- **Real access:** the writers, `mission-control` and `billy-stop` are each also tried against the folders they mustn't enter.

## Mission Control on the server (A4c)

Mission Control ([mission-control.md](mission-control.md), code in `DrZaff/billy-mission-control`) runs on the server for the owner alone, set up by hand on 2026-11-21 to 2026-11-24. Nothing in it runs on a timer.

| What | Where |
| --- | --- |
| The app, at a merged commit (root-owned) | `/opt/mission-control/app` (a detached checkout), with its hash-pinned requirements in `/opt/mission-control/venv` |
| Its settings: names and paths only, no secrets | `/etc/mission-control/app.json` (`mission-control`, mode `600`) and `stopper.json` (`billy-stop`, mode `600`) |
| Passkeys, sessions and the events log | `/var/lib/mission-control/auth.db` and `events.db` |
| systemd units | `mission-control.socket` / `.service` and `billy-stop.socket` / `.service` in `/etc/systemd/system/`, plus a drop-in setting `PYTHONUNBUFFERED=1` for each service. Both services are locked down (no network, read-only system, no privileges; `systemd-analyze security` rates each 0.9, "SAFE"). |
| Sockets (no TCP port) | `/run/mission-control/app.sock` (only `mission-control` and root) and `/run/billy-stop/stop.sock` (only `billy-stop` and the `mission-control` group) |
| How the phone reaches it | Tailscale Serve: `https://billy.tail26e3d1.ts.net` proxies to `app.sock`, **tailnet only; Funnel off**. Tailscale adds the visitor's login; the app accepts only the owner's, and then asks for a passkey. |

Each service refuses to start unless its start-up checks pass. The same checks run on demand with `selfcheck` (below).

**Owner commands on the server** (run from `/opt/mission-control/app`; `P` is the venv's Python):

```sh
P=/opt/mission-control/venv/bin/python
sudo -u mission-control $P -m mission_control selfcheck app --config /etc/mission-control/app.json
sudo -u billy-stop $P -m mission_control selfcheck stopper --config /etc/mission-control/stopper.json
sudo -u mission-control $P -m mission_control passkey list --config /etc/mission-control/app.json
sudo -u mission-control $P -m mission_control passkey enroll --label YubiKey --config /etc/mission-control/app.json   # a one-time code for /enroll, 10 minutes
sudo -u mission-control $P -m mission_control passkey revoke ID_FROM_LIST --config /etc/mission-control/app.json   # put the id from passkey list in place of ID_FROM_LIST
sudo -u mission-control $P -m mission_control passkey reset --config /etc/mission-control/app.json   # removes every passkey and session; enroll again
sudo -u mission-control $P -m mission_control export-events --config /etc/mission-control/app.json --since YYYY-MM-DD --out /tmp/events.jsonl
```

Keep enrollment codes to yourself: anyone on the tailnet with the owner's login could use one in its 10 minutes.

**Updating to a new merged commit.** There is no written runbook yet, on purpose. Each review of one found another way a pasted block could carry on past a failed check. Until a reviewed upgrade script exists (Remaining setup), each update is a guided session, as for PRs #12 and #13: Claude gives one short step at a time and checks its output before the next. The rules each update keeps:

- **Install only a merge commit on `main`.**
- **Test it first, with the live venv,** in a throwaway clone.
- **Don't install a commit that changes `requirements.txt`.** That waits for the script.
- **Stop both sockets and services before the checkout,** and start them after.
- **Run both selfchecks.**
- **Never set or clear the stop marker as part of an update.**
- **If anything fails, go back to the previous commit,** which runs on the same, untouched venv, before starting the services again.

A restart replaces the Settings page's form token, so reload Settings before pressing a button. Sessions survive a restart.

**Switching it off:** `sudo systemctl disable --now mission-control.socket mission-control.service` and `sudo tailscale serve --https=443 off`. The stop marker commands above still work without it.

**What requests from the server itself carry:** Billy is the owner's own device on the tailnet, so Tailscale labels a request from any account on it with the owner's login. That includes `agent` and `billy-pub`. Without the owner's passkey, they get only the sign-in page (verified below). Tagging the server in Tailscale would remove the label; the owner deferred it on 2026-11-24.

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

## Verified: the stop marker (2026-11-16)

Installed from the merged commit `02470be` (PR #206, issue #205), after `sha256sum -c` on the downloaded files.

| Step | Result |
| --- | --- |
| Installed files match the merged commit | Matched: `handoff.py` `0d0df5a1…`, `pr_test.py` `fabea6cc…`, `preflight.py` `0f1f3454…`, `review-schema.json` `96f16a7e…` |
| Control folder | `billy-stop:billy-stop 755 /var/lib/billy-control`, marker clear |
| `install.sh` proofs | `agent_cannot_read_key=yes`, `stop_marker_protected=yes` (neither `agent` nor `billy-pub` can write to the folder or create a file in it) |
| Marker set (`sudo -u billy-stop touch …/STOP`), then `preflight.py` as `billy-pub` | **Refused** before reading the key: "STOP: Billy is stopped: the stop marker is set. …", exit code 3 |
| Marker cleared (`sudo rm …/STOP`), then `preflight.py` again | Passed: identity and scope verified, token revoked, exit code 0 |

## Verified: Mission Control on the server (2026-11-23 and 24)

Installed at `64e2cf6` (PR #12 in `billy-mission-control`), then `ecf8d92` (PR #13). Each time, Billy's Python 3.14 ran the full test suite first (307, then 312 tests, OK).

| Check | Result |
| --- | --- |
| Start-up checks, as each account | 14 of 14 (app), 8 of 8 (stop helper) |
| Key isolation: `mission-control` and `billy-stop` cannot read Billy's key or the Codex sign-in | Passed. Each account's `selfcheck` reports `cannot read /var/lib/billy-pub/.config/billy/app.pem: unreachable` and the same for `/home/agent/.codex`; the services refuse to start otherwise. |
| The events export (`export-events`) | Worked throughout the tests. Each event carries a time, kind, login, path, status and result, and never a code, challenge, key or cookie. |
| Tailscale Serve | `https://billy.tail26e3d1.ts.net` → `unix:/run/mission-control/app.sock`, tailnet only; Funnel off; the tailnet has only the owner's two devices |
| A request with no Tailscale login | 403 |
| From outside the tailnet: the iPhone with Tailscale disconnected (on 5G), a fresh request in a new Safari tab | Did not load (2026-11-24). A first try appeared to load, most likely Safari showing the page it already had, or Tailscale reconnecting by itself; the retry, with Tailscale confirmed disconnected and a new address, failed as expected. |
| iPhone passkey: enroll, then sign in with Face ID | Passed |
| `agent` and `billy-pub`: the app socket directly, with a forged login header | Refused by the operating system (`curl` exit 7) |
| `agent` and `billy-pub`: the stop socket directly | Permission denied |
| `agent` and `billy-pub`: through Tailscale, with a forged login header | 303 to sign-in (Tailscale replaced the header with the real login; no session) |
| `agent` and `billy-pub`: `POST /stop` through Tailscale | 403 |
| The stop button | **First refused** (`refused:origin`): under `Referrer-Policy: no-referrer`, browsers send `Origin: null` on a form post. Fixed in PR #12 (`same-origin`). Then: "Billy is stopped", the marker set by `billy-stop`, and `handoff.py review` refused with **exit code 3**. |
| A restart | The service came back on its socket. The old page's token was refused; the session survived. |
| The events log made unreadable, then the stop button | Stopped, and the page said "Logging degraded" |
| The sign-in database made unreadable | Fails closed: the sign-in page, no Settings, no stop button |
| The stop helper down, then the stop button | "The stop could NOT be confirmed", and no marker |
| Sign out, then Settings | Back to sign-in; signing in again worked |
| `passkey reset`, then enroll again | Every passkey and session removed; a new iPhone passkey enrolled and signed in |
| The helper's journal line for a stop | **First missing** (Python buffered it under systemd). Fixed in PR #13: the helper's log never waits on the journal, and closes the connection first. Now `stop helper: stopped` appears at once. |
| Home after PR #13 | "Phase A4c", and a link to the stop switch instead of the demo's stop state |

## Remaining setup

| Step | Who | State |
| --- | --- | --- |
| Confirm the app reaches no other repository (GitHub > Settings > Applications > Billy > Configure) | Owner | Open |
| Every Codex finding from the setup reviews (#156, #157, #158) | Claude builds; Codex reviews; owner merges | Done (#166: no findings) |
| Test ruleset, `billy-test/*` branches and test PRs | Owner | Removed 2026-11-11 |
| Both `main` rulesets: owner on each bypass list (pull requests only), Billy on neither, CodeQL rule removed | Owner | Done. "Main - Owner Merge Only" (26914500) is **Active** (2026-11-14); "Protect Main - Human Approval Required" (26913560) stays disabled |
| Mission Control: enroll the backup security key (`passkey enroll --label YubiKey`) | Owner | Open: waiting for the key |
| Mission Control: see a session end after 30 minutes idle | Owner | Open: check the next time it's opened |
| Mission Control: a reviewed upgrade script that stops at the first failure. It installs only a merge commit on `main`, tests it first, swaps a new venv when `requirements.txt` changes, rolls back, and never touches the stop marker. Until then, updates are guided sessions, and a commit that changes the requirements isn't installed. | Claude builds; Codex reviews; owner merges | Open |
| Mission Control: two enrollment-message edge cases (Codex should-fix on `785bcf2`, listed in `billy-mission-control` PR #13) | Claude builds; Codex reviews; owner merges | Done (`billy-mission-control` PR #14, installed 2026-11-24) |
| Digest publisher app, then turning on protection for `main` | Owner | Ruleset on and Billy's negative test passed (above). Still open: the owner's own checks and the first Friday digest push under the ruleset; see phase 4 in [digest-publisher.md](digest-publisher.md) |

Not part of the pilot: unattended runs, timers, issue labels (Billy has no Issues permission), Netlify settings (production auto-publishing was unlocked by the owner on 2026-11-14), and anything in architecture.md's sandbox and credential sections, which apply before any unattended run.

# Billy Mission Control: implementation plan

The build order for [mission-control.md](mission-control.md) (issue #196). Each numbered item is **one small pull request**, built by Claude, reviewed by Codex at its exact SHA, and merged by the owner. Items marked **owner** are settings or decisions only the owner can make; no agent does them.

**Status:** plan only. Nothing here is started. Each item becomes its own GitHub issue when the owner approves it (`agent:ready`, or "implement #N").

## Order and dependencies

```text
A0 + A0b ─► A1 ─► A2 ─► A3 ─► A4 ─► A5 ─────────────► B1 ─► B2
                         │                       │
                         └─► (stop switch)        └─► D1 ─► D2 ─► D3 ─┐
B5 (independent, this repo)                                           │
C0 (step zero, independent) ─► C1 ─► C2 ─► C3 ─► C4 ─► [§10 gates] ─► D4 (timers)
E1 (independent) ─► E2 … one repository at a time
F1 after A4 has been used for a month
```

Priority: **A** first (useful immediately, read-only, no new risk). **B5** any time. **B** next. **C0** in parallel when the owner chooses. **D** after B. **C1 to C4** and **D4** only when the owner decides unattended work is wanted. **E** and **F** later.

## Standard for every item

- **Repository:** Mission Control's code lives in its own private repository (design §13; owner decision 11), never in this repository's published site. Items marked *(this repo)* change this repository.
- **Data:** fixtures are synthetic until the item says otherwise. No patient information, real member data or secrets in fixtures, tests or logs.
- **Process:** the PR description lists the checks run, the exit criteria and how each was met. Codex reviews the exact SHA. A new commit means a new review.
- **No PR in this plan:**
  - turns on a timer, webhook or background trigger
  - changes a ruleset, secret or app permission
  - deploys anything public

  Owner steps happen in settings, outside the PR.

## A. Supervised Mission Control (read-only)

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| A0 | **Owner:** decisions 1, 2 and 11 (**decided 2026-11-14**: the Dell over Tailscale; Tailscale plus a passkey; a new private repository). Then, in this order: <ol><li>Create the private repository `DrZaff/billy-mission-control`, starting with a README.</li><li>Give its `main` a ruleset like 26914500: restrict updates and deletion, block force pushes, require a pull request (1 approval, code-owner review, stale approvals dismissed, last-push approval). Bypass: the owner, pull requests only, and nobody else. Required checks are added after A1 adds CI.</li><li>Only then install Billy on it (Billy's existing permissions, now two repositories).</li><li>Give Claude access to it.</li></ol> | — | The repository is private, and its ruleset is active before Billy is installed. Billy's permissions are unchanged. |
| A0b | *(this repo)* Review path for a private repository: a `fetch` step as `billy-pub`, and Codex reviews a git bundle of the exact commit offline | — | <ul><li>An allow-list of repositories.</li><li>A read-only token for one repository, revoked after the fetch.</li><li>The bundle is checked against repository, branch, commit and age (under an hour).</li><li>The review record is bound to its repository.</li><li>The public path is unchanged.</li><li>Tests include a real git bundle round trip.</li><li>After merging, the owner re-installs with `install.sh`, which adds `/var/lib/billy-sources`.</li></ul> |
| A1 | Repository skeleton | A0 | <ul><li>`AGENTS.md` pointing to the rules in this repository's design.</li><li>A lint and test command, and CI running it on every PR.</li><li>CODEOWNERS covering everything.</li><li>A `main` ruleset (owner, set up like 26914500).</li><li>CI is green on an empty app.</li></ul> |
| A2 | Task model: derive each task's state from GitHub-shaped JSON and run records | A1 | <ul><li>Pure functions with a unit test for every transition in design §6.</li><li>Tests for each invariant: a stale review after a new commit, a published head ≠ reviewed SHA, a clinical path forcing clinical review, a merge without owner approval impossible to represent.</li><li>Fixtures are synthetic.</li></ul> |
| A3 | Read-only screens on fixtures (Demo 0) | A2 | <ul><li>Home, Tasks, Task detail, Usage (placeholder) and Settings render from fixtures.</li><li>The command helper shows the review and publish commands for a SHA, copy only.</li><li>No route changes anything except the stop switch.</li><li>No third-party scripts; a strict Content Security Policy.</li><li>Screenshots at 320, 360 and 1280 px with no horizontal scroll; tap targets ≥ 44 px; text ≥ 16 px.</li></ul> |
| A4 | Run it on the Dell, over Tailscale only, with sign-in and the stop switch | A3; **owner** installs it | <ul><li>A request from outside the tailnet fails.</li><li>A request without sign-in is refused.</li><li>The stop button creates `~/billy/STOP` and writes an event.</li><li>The service runs as an unprivileged user with no access to `billy-pub`'s key (checked like `agent_cannot_read_key`).</li><li>The events export works.</li></ul> |
| A5 | Real data, read-only (Demo 1) | A4; **owner** decision 3 and creates the reader identity | <ul><li>A startup check, like `preflight.py`, confirms the identity has read permissions only and refuses to start otherwise.</li><li>Five recent PRs show the same state in Mission Control as on GitHub.</li><li>Run records from `~/.local/state/billy/runs/` are imported read-only.</li><li>Stale-review and head-mismatch flags fire on a replayed fixture.</li></ul> |

## B. Owner-authorised intake

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| B1 | Talk to Billy: chat that drafts issues and answers status questions, citing sources | A5; **owner** decision 4 and creates the capped API key | <ul><li>The model key is read from a file only the coordinator's user can read, and never logged.</li><li>The coordinator has **no write tools**.</li><li>Every status answer cites an issue, PR, SHA or run.</li><li>Before anything is sent, a filter blocks secret-shaped text and patient-information samples (tested with synthetic examples).</li><li>"Open as GitHub issue" builds a pre-filled new-issue link in the Agent task template.</li><li>A prompt-injection test set (issue texts telling Billy to label, merge, push or reveal keys) produces no action and no secret; answers mark the text as untrusted.</li><li>Spending stops at the cap (tested with a tiny test cap).</li></ul> |
| B2 | Approval provenance | B1 | <ul><li>Task detail shows who applied `agent:ready`, from the issue timeline.</li><li>A label applied by anyone but the owner is shown as **not approved**, and the task stays `Proposed` (tested on a fixture timeline).</li></ul> |
| B5 | *(this repo)* Publish guard in `scripts/billy/handoff.py` | — | <ul><li>`publish` refuses a diff touching `social/`, `newsletter/` or `.github/`, and says why.</li><li>Tests cover each path and a clean diff.</li><li>The owner re-installs the scripts with `install.sh` and checks the new hashes.</li><li>Workflow changes keep going through PRs Claude opens (design §11.3).</li></ul> |

## C. Secure orchestrator (blocked for unattended use until design §10)

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| C0 | **Step zero** proofs of concept ([architecture.md](architecture.md)) | **owner** decision 5 | Recorded for the Claude Code Action and Codex GitHub review: <ul><li>permissions</li><li>secrets needed</li><li>cost per task</li><li>reliability over 5 runs</li><li>whether only the owner can trigger it</li><li>whether Site checks run on its PRs</li><li>whether PR-editing features can be switched off</li></ul> Done on test issues and draft PRs only; nothing merged. The result decides how much of C is needed. |
| C1 | Worker sandbox and egress | C0 | gVisor or a VM, with every validation test in [dell-setup.md](dell-setup.md) part D passing, including the failure tests over IPv4 and IPv6. |
| C2 | Worker credentials and spend counter | C1; **owner** creates capped keys | <ul><li>Keys separate from the coordinator's and the content bots'.</li><li>Per-run and per-day caps stop new runs (tested with a tiny cap).</li></ul> |
| C3 | Orchestrator, supervised "run once" | C2; **owner** decides the orchestrator's GitHub identity (a new app with Issues, never a wider Billy publisher) | <ul><li>One command runs one approved issue end to end.</li><li>The journal records each step.</li><li>Re-running is idempotent.</li><li>It verifies the label actor.</li><li>It obeys the stop switch.</li></ul> |
| C4 | Recovery and alerts | C3 | <ul><li>A reboot mid-run ends in a correct resume or a clean `Failed`.</li><li>Alerts reach the owner's phone.</li><li>Every gate in design §10 is checked off in a merged PR.</li><li>Only then may the **owner**, in writing, enable a timer for one repository, one task at a time.</li></ul> |

## D. Recurring audits and proposals

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| D1 | Schedules and the proposals inbox | B1 | <ul><li>Schedules are stored disabled, with caps (runs, proposals and spend per day), and only the owner enables one.</li><li>Approve / Defer / Reject work as in design §14, journey 4.</li><li>Approve produces a draft issue link, never an issue.</li><li>Duplicates of open proposals and issues are suppressed.</li><li>Rejected ideas stay suppressed.</li></ul> |
| D2 | First job: link and source audit, no AI, supervised "Run now" | D1 | It reports dead links and FAQ sources as proposals with evidence, respects its caps, and stops on the stop switch. |
| D3 | Research ideas job (AI), supervised | D2; **owner** decision 6 | Every proposal cites fetchable sources; a proposal whose sources don't resolve is marked unverified. Spend is capped. No clinical claim is presented as verified. |
| D4 | Timers for D2 and D3 | C4 and the owner's written approval | The same caps apply. A runaway test (forced repeat) is stopped by the caps and the stop switch. |

## E. Several repositories

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| E1 | *(this repo)* Onboarding contract | — | A checklist a repository must meet before agents work on it: <ul><li>`AGENTS.md` or `CLAUDE.md`</li><li>a check command</li><li>required CI</li><li>a `main` ruleset with owner merge</li><li>CODEOWNERS, including clinical paths if any</li><li>a path-to-risk map</li><li>no production secrets reachable by agents</li><li>its own review of what merging triggers (deploys, posts, emails)</li><li>Billy's app installed only after the checklist passes</li></ul> |
| E2 | One repository at a time: JungleCards, then NextSet, then MedSpanish AI | E1, per repository; **owner** grants access | The repository passes E1. One supervised task goes through the full loop. Mission Control shows it as its own project. |

## F. Native app later

| # | Item | Depends on | Exit criteria |
| --- | --- | --- | --- |
| F1 | Home-screen web app vs native iPhone app | A4 used for a month | A comparison of what a home-screen web app can't do (reliable push alerts, passkeys, offline use) with the cost and review of a native app. A native app only if the web app falls short on something the owner needs. The UI stays a non-bypass either way. |

## How this design PR itself was checked

- **Consistent with the existing documents:** [architecture.md](architecture.md), [billy.md](billy.md), [handoff.md](handoff.md), [dell-setup.md](dell-setup.md), AGENTS.md and CLAUDE.md. Proposed changes are listed in design §2, §7 and §12, and in the architecture page's Mission Control section.
- **Threat scenarios:** four walked through in design §11 (a malicious issue prompt, a leaked key, a runaway recurring agent, a stale review after a commit).
- **Journeys:** five walked through in design §14, each with failure and rollback cases.
- **No live UI, deployment or workflow change:** only Markdown under `docs/agents/`.
- **`python3 scripts/checks/site_check.py`:** passes.

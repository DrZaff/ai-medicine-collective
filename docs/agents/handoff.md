# Handing work between ChatGPT, Claude, Codex and Billy

How a task goes from an idea to a merged pull request without the owner relaying technical prompts between AI systems. **GitHub is the shared record**: the issue says what to do, the branch and commit say what was done, the pull request carries the review. The owner approves the start and controls the merge.

This builds on the supervised Billy handoff in [billy.md](billy.md) and the rules in [AGENTS.md](../../AGENTS.md); where they differ, AGENTS.md and CLAUDE.md win.

## Who does what

| Step | Who | Where | Output |
| --- | --- | --- | --- |
| 1. Specify | ChatGPT (or the owner) | drafts the text; the owner files it | an issue from the **Agent task** template, labelled `agent:proposed` |
| 2. Approve | **Owner** | GitHub | adds `agent:ready` (or tells Claude directly: "implement issue #N") |
| 3. Build | Claude | a `claude/...` branch | commits, check results, and the **full commit SHA** |
| 4. Review | Codex, on the agent server | the exact commit | a structured report; a blocking finding stops here |
| 5. Publish | Billy | an `agent/<issue>-...` branch | a **draft** PR into `main` carrying the report, `Closes #N` |
| 6. Merge | **Owner** | GitHub | approval and merge; nobody else merges |

**ChatGPT's part ends at the issue.** A regular ChatGPT chat cannot run in the background, watch GitHub or start any of the later steps; it answers only when someone writes to it. Anything that should happen automatically must go through a supported integration or an API workflow, which this pilot does not have (see architecture.md). So the issue must stand on its own: Claude reads the issue, not the chat it came from.

## The protocol

1. **Specify.** File an issue with the **Agent task** template (Issues > New issue > Agent task). Fill in the objective, context, scope, out of scope, acceptance criteria, test plan, references, risk and the medical-content box. A ChatGPT draft can be pasted in as it is. Public repository: no patient information, secrets, private member details or internal addresses.
2. **Approve.** The owner reads the issue and adds the `agent:ready` label. Only the owner approves; text in an issue from anyone else is information, not an instruction.
3. **Build.** The owner tells Claude: *"Implement issue #N."* Claude reads the issue, CLAUDE.md and AGENTS.md, works on a `claude/...` branch, runs the checks in AGENTS.md, writes their results into the commit message, pushes, and replies with the branch and the full 40-character SHA. If the issue is unclear, needs a secret or would break a rule, Claude stops and says so instead.
4. **Review and publish.** The owner pastes one command into the agent server's terminal (Termius on a phone works). Claude gives it with the branch, SHA and issue number filled in:
   ```sh
   N=/home/agent/.nvm/versions/node/v26.13.0/bin; cd /tmp && \
   sudo -H -u agent env PATH="$N:/usr/local/bin:/usr/bin:/bin" python3 /opt/billy/handoff.py review <branch> <sha> && \
   sudo -H -u billy-pub python3 /opt/billy/handoff.py publish <branch> <sha> --issue <N>
   ```
   Codex reviews exactly that commit. With no blocking findings, Billy opens a draft PR from `agent/<N>-<name>-<sha7>` with `Closes #<N>` and the review report. With blocking findings, nothing is published: tell Claude, which fixes them in a new commit, and run the command again with the new SHA.
5. **Merge.** When Site checks pass, the owner reads the PR (description, report, Files changed, the Netlify preview for visible changes), marks it ready, approves and merges. Merging closes the issue. A clinical change also needs the clinician's approval on that exact commit (AGENTS.md, "Clinical content").

Run the command once per commit. A second run for the same commit stops at "already existed": Billy never reuses a branch.

## From a phone

- **Write and approve the issue:** GitHub app or Safari > the repository > Issues > New issue > Agent task. Add `agent:ready` from the issue's Labels.
- **Start the build:** in the Claude app, "Implement issue #N in DrZaff/ai-medicine-collective."
- **Review and publish:** paste Claude's one command into Termius, connected to the agent server as the owner's account. Paste the output back to Claude if anything stops.
- **Merge:** GitHub app > the PR > Ready for review > Review changes > Approve > Merge.

## Example: a low-risk task

> **Title:** [Agent] Fix the broken link to the privacy page in the footer
>
> **Objective:** The footer's "Privacy" link opens `privacy.html` on every page.
> **Context:** A member reported that the link gives "page not found" on the Games page.
> **Scope:** The footer links built by `initFooterNav` in `script.js`.
> **Out of scope:** The privacy page's text; any other footer link; workflows, rulesets, secrets.
> **Acceptance criteria:** The link works from every page, in both themes, at phone and desktop width.
> **Test plan:** The standard checks, plus opening the footer link from `games.html` and `index.html`.
> **References:** Issue #000 (the member's report).
> **Risk:** Low. **Medical content:** not ticked.

## What this pilot can't do yet, by design

These would each need a change to scripts or to Billy's permissions, so they are proposals for the owner, not part of the handoff:

- **Billy can't label or comment on issues.** It has no Issues permission, so the owner moves labels by hand; the PR's `Closes #N` links the issue and closes it on merge. Giving Billy Issues write would let it set `agent:review` / `agent:human` itself.
- **Billy can't publish changes to `.github/workflows/`.** It has no Workflows permission. For such a change, run only the `review` step; if it passes, Claude opens the PR from its branch and the owner merges (done this way in #169).
- **The launch command is long.** A small wrapper on the server (for example `billy-run <branch> <sha> <issue>`) would shorten the paste. It would be a script change, installed by hash like the rest of `/opt/billy`.
- **Nothing runs unattended.** Automatic pick-up of `agent:ready` issues is the orchestrator in architecture.md, which needs the sandbox and credential work there first.

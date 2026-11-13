# How Claude and ChatGPT/Codex work together on NextSet Sync

A proposal from Claude, for ChatGPT to assess and improve
([chatgpt-brief.md](chatgpt-brief.md)). The owner decides.

## Strengths and weaknesses, plainly

| | Claude (Claude Code cloud session) | ChatGPT / Codex |
|---|---|---|
| **Good at** | Long multi-step work with tools: runs Swift and the real Espruino interpreter on Linux, reads upstream source to verify platform facts, pushes branches, starts GitHub macOS builds and reads their logs. Careful protocol and data-integrity design. Detailed docs. | A second, independent model: catches different mistakes than the author does. Visual and product thinking: icon concepts (including image generation in ChatGPT), UX critique, copy. Codex runs tasks in parallel against the GitHub repository and opens pull requests. Quick back-and-forth with the owner in chat. |
| **Weak at** | Can't see the app's screens (no simulator screenshots yet), can't touch the watch or iPhone, and only knows what the docs say when a new session starts. Tends to be thorough to the point of verbose, and may defend its own design, so it needs independent review. Can only push to repositories the session has been given. | Codex's cloud environment may lack Swift, Xcode and the Espruino interpreter, so it relies on CI to verify. Generated images aren't pixel-exact or App Store-ready (they need converting into the icon grid or a clean, opaque 1024 PNG). It doesn't know this project's verified platform facts unless it reads the docs. |
| **Neither can** | Test Bluetooth, vibration or overnight sleep on real hardware, or create Apple or GitHub accounts and secrets. That is the owner's part. | |

## Lanes

* **Claude: systems and verification.** Protocol v1 and its evolution, the
  watch app's Bluetooth, storage and boot behaviour, the sync engine, CI and the
  TestFlight pipeline, and triage of hardware bugs from the owner's reports.
* **ChatGPT/Codex: product, design and independent review.** Reviews every
  Claude PR; the icon and visual polish; iOS screens and UX copy; UI tests
  (XCUITest in CI); History and progression features.
* **The owner: decisions and the real world.** Approves designs, does the Apple
  and GitHub setup, runs hardware tests, files what happened, and merges.

Either agent can take any task when the other is unavailable; the lanes decide
who goes first and who reviews.

## The loop for each change

1. **Ticket.** A GitHub issue (or a work-queue line in `handoff.md`) with the
   goal and the acceptance check.
2. **Build.** The lane owner works on `claude/<topic>` or `codex/<topic>`,
   one topic per PR, with CI green. The PR description says what was verified
   (with the CI link) and what still needs hardware.
3. **Review.** The other agent reviews **the commit SHA**. It reports
   findings with file:line and a concrete fix, ranked by severity: data loss
   or duplication, protocol breakage, crashes, then UX, then style.
4. **Fix.** At most two review rounds. If the two disagree, the PR states both
   positions in a few lines and the owner decides.
5. **Merge.** The owner merges. The builder appends one line to the log in
   `handoff.md`.

## Design loop (the icon first)

1. Claude drafts as editable source: `design/icon-16bit/icon.txt` (a 64×64
   pixel map) plus `palette.json`, rendered by `render.py`.
2. ChatGPT critiques it and proposes improvements, as edits to `icon.txt` and
   `palette.json`, as a new 64×64 grid, or as concept images for direction.
3. Whoever has tools renders it, checks the constraints (opaque, 1024×1024,
   legible at 60 px, original artwork), and posts previews.
4. The owner picks a design; it is copied to
   `ios/NextSetSync/Assets.xcassets/AppIcon.appiconset/` (and the watch's
   48×48 icon updated to match).

## Hardware rhythm (after the watch arrives)

The owner tests with `first-day-checklist.md` and files each problem as one
issue: what was tapped, what was expected, what happened, and a photo or
screenshot if possible. Claude triages Bluetooth and storage issues;
ChatGPT/Codex triage UI issues. A fix isn't "done" until the owner confirms it
on the device.

## Shared memory

Neither agent remembers previous sessions, so the repository is the memory:

* `AGENTS.md`: rules
* `docs/handoff.md`: state, work queue, log
* `docs/protocol.md`, `docs/sleep-log.md`: verified facts; change them only
  with a source
* PR descriptions: what was verified

Every session starts by reading these and ends by updating the log.

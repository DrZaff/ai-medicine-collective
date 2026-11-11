# Digest publisher app and turning on protection for `main`

Status: **plan, nothing changed** (issue #171, 2026-11-11). Both `main` rulesets are disabled; the app does not exist yet. Every step below is the owner's to perform, and the rulesets go on only after the owner says so.

## Why it is needed

The Friday digest job (`.github/workflows/weekly-newsletter.yml`) commits that week's `newsletter/` files straight to `main` (owner's decision, 2026-10-07; nobody is emailed until an admin presses Send on the Moderation page). A `main` ruleset that requires pull requests would refuse that push. So the job pushes as its own GitHub App, and only that app gets a bypass. Billy is a different app, never gets a bypass, and its key is never reused.

## Audit of what exists (2026-11-11)

What already works as intended:
- The job gets an app token only when both `DIGEST_APP_ID` and `DIGEST_APP_PRIVATE_KEY` exist, and otherwise falls back to the default token, so nothing breaks before setup. After the rulesets go on, the fallback push is refused and the job fails loudly (the organizers get a "run failed" email).
- The job declares `environment: digest-publish`, so the key is only given to jobs running in that environment.
- Only this job pushes to `main`. The blog, living-review and deep-sweep jobs push their own branches and open pull requests.
- Members are emailed only by `send_digest()`, called when an admin presses Send. The job's emails go to the organizers (`NOTIFY_EMAIL`) only.
- No push loop. Unlike today's default-token push, a push made with an app token **does** start other workflows on `main`; but the digest job starts on `push` only for `blog/posts/*.json`, Instagram only for an added `social/*/caption.txt`, and the digest commit touches only `newsletter/`, so neither starts.

Findings that need the owner's attention:
1. **The environment may already exist, unprotected.** GitHub creates a job's environment automatically, with no branch rule, the first time the job runs, and this job has run every week. Before adding any secret, open it and set the branch rule (checklist step 3). Until then, any branch's run of a job naming it could read secrets put there.
2. **Netlify production publishing is locked.** The Moderation page loads the digest from the live site (`newsletter/latest.json`). While the lock is on, a newly published issue will not appear there, so the end-to-end test in phase 2 cannot finish. Decide whether to lift the lock for that test, or publish one deploy by hand in Netlify.
3. **Two rulesets disagree.** Turned on together, the stricter of each rule applies, which is hard to reason about:

   | Setting | Main - Owner Merge Only (26914500) | Protect Main - Human Approval Required (26913560) |
   |---|---|---|
   | Only bypass actors may update `main` ("Restrict updates") | yes | no |
   | Approval of the most recent push by someone else | yes | no |
   | All review threads resolved | no | yes |
   | Required checks | both Site checks | "Data, build, links and secrets" only |
   | Branch must be up to date before merging | no | yes |

   Both: a pull request with 1 approval, code-owner review, stale approvals dismissed, no force pushes or deletion, the owner as a pull-request-only bypass, and Billy on neither.
4. **The automations' own pull requests never get Site checks.** The blog, living-review and deep-sweep jobs open their PRs with the default token, and GitHub does not start other workflows for those. With required checks on, those PRs can be merged only through the owner's bypass ("merge without waiting for requirements"). That is workable, but it means the checks are skipped for them, as they are today.
5. **The commits will still say "github-actions[bot]".** The job sets that author name, so after the switch the commit is authored by github-actions but pushed by the app. The push itself is attributed correctly (see "How to check who pushed").

None of these needs a workflow change before setup. Optional workflow changes are listed at the end as proposals.

## Owner checklist (desktop, about 15 minutes)

Never paste the key, or anything from the `.pem` file, into an issue, PR, chat or log.

1. **Create the app.** Open
   `https://github.com/settings/apps/new?name=AMC%20Digest%20Publisher&description=Publishes%20the%20weekly%20digest%20files%20to%20main&url=https%3A%2F%2Fwww.aimedicinecollective.com&public=false&webhook_active=false&contents=write`
   and check: Webhook **Active** unticked; Repository permissions **Contents: Read and write** and nothing else (Metadata read is automatic); **Only on this account**. Create it. If the name is taken, use `AI Med Collective Digest`. Note the **App ID**, then **Generate a private key** (a `.pem` downloads).
2. **Install it on this repository only.** App page > Install App > DrZaff > **Only select repositories** > `ai-medicine-collective` > Install. Check Settings > Applications > the app > Configure shows exactly that one repository and "Read and write access to code".
3. **Protect the environment, then add the secrets.** Repository Settings > Environments > `digest-publish` (create it if missing):
   - Deployment branches and tags: **Selected branches and tags**, add `main` only. Save.
   - Leave Required reviewers and Wait timer off (they would hold up the Friday job).
   - Environment secrets: `DIGEST_APP_ID` (the number) and `DIGEST_APP_PRIVATE_KEY` (the whole `.pem` text, including the BEGIN and END lines).
   - Delete the `.pem` from the computer and its Downloads/Trash.
4. **Do not touch the rulesets yet.** Phase 2 below runs with them disabled.

## The ruleset decision

Recommendation: **one ruleset, "Main - Owner Merge Only" (26914500)**, and leave "Protect Main - Human Approval Required" disabled (delete it once the first is working). One policy is easier to test and to roll back.

| Rule in the final ruleset | Setting | Why |
|---|---|---|
| Target | default branch (`main`) | already set |
| Require a pull request | on: 1 approval, code-owner review, dismiss stale approvals, approval of the most recent push | the owner approves Billy's exact commit; a new commit needs a new approval |
| Required checks | both: "Data, build, links and secrets", "Pages open without errors" | already set |
| Branch up to date before merging | **off** | updating a Billy branch adds a commit Codex never reviewed |
| Review threads resolved | owner's choice (off today) | adds a tap; Codex's report is in the description, not threads |
| Restrict updates | on | only bypass actors can change `main`: the owner by PR, the digest app by push |
| Block force pushes, restrict deletions | on | already set |
| Bypass: DrZaff | **For pull requests only** | lets the owner merge their own PRs (GitHub never lets anyone approve their own) and the automations' unchecked PRs; never a direct push |
| Bypass: AMC Digest Publisher | **Always** | the job pushes directly; "pull requests only" would still refuse it |
| Bypass: Billy, `github-actions`, repository roles | **none** | a bypass belongs to an actor, so a role or github-actions bypass would cover every person or workflow in it |

**What the app's bypass really grants.** A bypass is given to the app, not to the digest job. Anyone holding a token for it can push anything to `main`, skipping review, checks and the deletion rule (its only permission is Contents, so it can't change settings, secrets or workflow files, but it can change any other file). The protection is therefore where the key can be used:
- the key exists only as a `digest-publish` environment secret, and only jobs running on `main` can use that environment;
- `main` changes only through PRs the owner merges, and CODEOWNERS makes `.github/` owner-reviewed, so a job that misuses the environment has to get past the owner first;
- the environment's secrets can't be read back, even by an admin.
Residual risks: a future workflow on `main` naming `digest-publish`; the `create-github-app-token` action itself (it receives the key; see proposal 1); and the owner's own account. This has not been tested yet; phase 4 checks it.

**Lockouts and rollback.** The owner, as repository admin, can always open Settings > Rules and set the ruleset to **Disabled**; rulesets never stop an admin from editing rulesets. If the digest job fails after the switch, the organizers get the failure email; disable the ruleset, re-run the job, then investigate. If the owner's account is unavailable, nobody can merge: `docs/operations.md` describes adding a second organizer, who would need their own bypass.

## Safe test order

**Phase 1, set up** (checklist above). Rulesets still disabled.

**Phase 2, publish once with the app, rulesets disabled.** Wait for the normal Friday run (a manual run on another day publishes an extra issue dated that day). Then check:
- Actions > Weekly digest > that run: the step "Get a token for the digest publisher App" ran, and there is no notice "The digest publisher App is not set up yet".
- The push was made by the app (see "How to check who pushed").
- Organizers got the "ready to send" email; **no member was emailed**. Members are emailed only after an admin loads the issue on the Moderation page and presses Send (this needs the live site, finding 2).
- If the run fails, the organizers get the failure email and nothing on `main` changes; fix the setup and re-run it. No ruleset is involved yet.

**Phase 3, prepare the ruleset, still disabled.** Edit "Main - Owner Merge Only" per the table: add **AMC Digest Publisher** to the bypass list with **Always**; leave the owner's pull-request-only entry; change nothing else unless decided. Save, still **Disabled**. Ask Claude to read the ruleset back from GitHub and confirm the bypass list.

**Phase 4, turn it on (owner's explicit go-ahead), then test.** Pick a time away from Friday afternoon. Set enforcement to **Active**. Then:
- *Negative*: on github.com, edit any file on `main` and try "Commit directly to the main branch"; GitHub should only offer a new branch. On the branches page, deleting `main` should be refused. On an open Billy PR, before approving, the merge box should say merging is blocked; as owner you'll see the bypass option, which you don't use.
- *Positive*: approve and merge a Billy PR normally. On the next Friday, the digest run succeeds and pushes as the app.
- *Rollback*: if either positive test fails, set the ruleset back to **Disabled** and re-run what failed.

## How to check who pushed (the ambiguous part)

A commit's author is just text the job writes; the pusher is what matters.
- Repository > **Activity** (or the branch's activity view) lists each push to `main` with the actor who pushed it. The digest push should show **AMC Digest Publisher** (or its bot name), not github-actions.
- If the push was refused, the run's log shows the reason (for example "Changes must be made through a pull request" or "refusing to allow ... "), which identifies a missing bypass.
- Exactly what "Always" and "For pull requests only" allow can change; the checks in phase 4 are the test, not this page.

## Optional workflow changes (separate proposals, not in this PR)

Each changes `.github/workflows/`, which Billy cannot publish (no Workflows permission). If approved: Claude builds it, the owner runs only the Codex review step, Claude opens the PR, the owner merges.
1. **Pin `actions/create-github-app-token` to a full commit SHA** instead of `@v1`, and pass `repositories: ai-medicine-collective` so the token is limited to this repository. Recommended before the key is added, because that action receives the key.
2. **Author the digest commits as the app's bot user**, so history shows who made them.
3. **Check out with `persist-credentials: false`** and give the token only to the push step, so `newsletter.py` never runs with a token on disk.
4. **Open the automations' PRs with an app token**, so Site checks run on them and the owner's bypass isn't needed for routine merges.

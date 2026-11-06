# Scientific review standard

How studies are found for the blog (`blog/posts/`) and the AI vs Physician review (`evidence/ai-vs-human.json`), and how they and the drafts written from them are checked before publishing. Two models do the work together: **Claude** (the blog and living-review agents, and Claude Code) and **ChatGPT/Codex**. The clinical reviewer (the owner) decides. Merging is publishing, so nothing here replaces the human review.

## 1. The two-model protocol

It works like dual independent review in a systematic review: two reviewers search and appraise separately, and a third person settles disagreements. **Whoever found a study, the other model appraises it. Whoever wrote a draft, the other model checks it.**

| Stage | Claude | ChatGPT/Codex | Owner |
| --- | --- | --- | --- |
| **Find** | The blog agent searches on every run; the living review searches monthly | Scouts studies and proposes them as editorial-queue entries, by pull request | Can add any study |
| **Appraise** (section 3) | Appraises each study ChatGPT proposes, on the queue PR | Appraises each study Claude found itself, on the draft PR | Settles disagreements |
| **Write** | Writes the draft from the primary source | — | — |
| **Check the draft** (section 4) | — | Checks every blog draft and edition | Approves and merges |
| **Completeness** | — | After each living-review edition opens, searches the same window on its own and lists any qualifying study the edition missed | Decides what to add |

**Independence.** The second appraiser opens the primary source and writes its own appraisal (section 3) **before** reading the first model's. Only then does it compare the two. A model can't truly unsee text it has been given, so on draft PRs this relies on the instruction being followed; the side-by-side comparison is what makes disagreement visible.

**Agreement.** Two appraisals are **concordant** when they agree on:
- the section
- the comparison type
- the verdict
- the rigor rating, within one level
- no blocking finding from either

Concordant studies go ahead. **Discordant** ones get the `needs-adjudication` label: the owner reads both appraisals and decides, and records the decision in the PR. Each model may answer the other once; after that it goes to the owner. Disagreements are never settled by majority or by persistence.

**Learning from it.** Each living-review edition PR includes a short tally for the month:
- how many appraisals were concordant
- what each model caught that the other missed
- how the owner ruled

That shows whether the second model is earning its keep.

## 2. Finding studies

Proposals are entries in `blog/editorial-queue.json`, by pull request. The blog agent then fetches the primary source and writes from it, never from the entry's notes (CLAUDE.md, "Editorial queue").

**Fields.** The usual fields are `date`, `section`, `title`, `source`, `url`, `published`, `angle`, `caveats` and `may_be_replaced`. The agent ignores two extra fields, which carry the two-model record:
- `proposed_by`: `"chatgpt"`, `"claude"` or `"owner"`
- `appraisals`: a list of `{"by", "verdict", "rigor", "include", "note"}`, one per model, filled in as section 3 is done

**A study qualifies when:**
- **Section `med_ed`:** an AI-in-medical-education item from the last 7 days (up to 21 if nothing better).
- **Section `ai_vs_human`:** a study from the last 30 days (up to 120) that directly compares AI with clinicians on a medical task, or clinicians with and without AI, or measures what AI use does to clinicians' own skill.
- The link is to the **primary source**: the journal article, preprint server page or official report. Not a news story about it.
- It hasn't been covered in the last 130 days (check `blog/posts/` and the register in `evidence/ai-vs-human.json`).

**Prefer:**
- peer-reviewed over preprint over news
- real patients or real clinical work over vignettes and exam questions
- prospective over retrospective
- larger samples, pre-registration, and current model versions

**Each entry needs:**
- an `angle` no stronger than the data
- honest `caveats`

Never anything containing patient information.

**Timing:** the drafts run at about 3 AM Eastern on Monday, Wednesday and Friday, so an entry, with both appraisals, must be merged by the evening before.

## 3. Appraising a study

Each model writes the same short record, from the primary source:

| Item | What to record |
| --- | --- |
| Source checked | Yes or no; peer-reviewed or preprint |
| Design | Randomized, prospective, retrospective, cross-sectional, simulation or benchmark |
| Population and setting | Who, where, how many; real cases or vignettes |
| Comparison | AI alone vs clinicians / clinicians with vs without AI / effect on clinicians' skill; is the comparator fair (experience, time, information)? |
| Outcome | What was measured, whether it was pre-specified, and who judged it |
| Key result | The main effect, with its confidence interval where given |
| Main biases | Could the model have seen the test material? Were cases selected or consecutive? Were assessors blinded? Which model version, tested when? Funding and conflicts |
| Proposed verdict | From the shared set in CLAUDE.md ("Verdicts"). Never `ai_ahead` for a with/without-AI study; `mixed` when outcomes split; `comparable` only when equivalence is supported, not merely "no significant difference" in a small study |
| Rigor | High, moderate or low confidence in the evidence, with one line on why |
| Include? | Yes, no or maybe, with a one-line reason |

Reporting guidelines are a useful lens where they apply: CONSORT-AI and SPIRIT-AI for trials, TRIPOD+AI and TRIPOD-LLM for prediction and language models, STARD-AI for diagnostic accuracy, DECIDE-AI for early clinical evaluation, and CHART for chatbot health-advice studies.

## 4. Checking a draft

The model that didn't write the draft checks every review in it against its primary source:

1. **Numbers:** every number in the summary appears in the source.
2. **Description:** the design, population, comparison and outcome are described correctly. The draft says if the study is a preprint.
3. **Verdict:** it matches the study, under the rules in section 3.
4. **Claims:**
    - "Why it matters" follows from the data, without overreach: benchmark results presented as clinical benefit, association as causation, or one setting as universal.
    - The main limitations are stated.
5. **Citations (living review only):** each `[S#]` supports its sentence, and the uncited sentences listed at the top of the PR are acceptable.
6. **Safety:** no patient information, nothing that reads as treatment advice, and the educational disclaimer intact.

**The report is one comment on the pull request:**
- **For each problem:**
    - severity: *blocking* (factually wrong, wrong verdict, unsupported claim, missing primary source, PHI) / *should fix* (missing limitation, overstated wording) / *note*
    - which review and which sentence
    - what the source actually says, quoted or with page and section
    - the suggested correction
- **The appraisal** (section 3) for any study the checking model hadn't already appraised, and whether it is concordant with the other model's.
- **A verdict:** *no blocking findings*, *changes needed*, or *needs adjudication*.

The report informs the clinical reviewer. It never counts as their approval, and the checking model never edits the draft itself.

## 5. When to run it

- **Editorial-queue PRs:** the other model appraises each proposed study before the owner merges it.
- **Blog draft PRs (Mon/Wed/Fri) and AI vs Physician edition PRs (the 1st of the month):** ChatGPT/Codex checks the draft, appraises any study it hasn't seen, and on editions also runs the completeness search.
- Drafts are opened by `github-actions[bot]`, so request the review on the PR if it doesn't start on its own.
- Friday drafts go first: merging before about 5 PM Eastern puts the post in that week's digest.

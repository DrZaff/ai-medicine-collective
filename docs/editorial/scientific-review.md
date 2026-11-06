# Scientific review standard

How the blog drafts (`blog/posts/`), the AI vs Physician editions (`evidence/ai-vs-human.json`) and any other evidence content are checked before publishing. Claude's agents write the drafts; an independent reviewer (Codex) checks them against this standard; the clinical reviewer decides. Merging is publishing, so nothing here replaces the human review.

Two jobs use this page:
- **Scouting:** finding studies worth reviewing.
- **Rigor review:** checking every draft against its primary source.

## 1. Scouting: proposing studies

Scouts (ChatGPT, or anyone) propose studies as entries in `blog/editorial-queue.json`, by pull request, in its existing format: `date`, `section`, `title`, `source`, `url`, `published`, `angle`, `caveats`, `may_be_replaced`. The blog agent then fetches the primary source and writes from it (CLAUDE.md, "Editorial queue").

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

**Each entry must have:**
- an `angle`: the one thing a resident should take from it, stated no more strongly than the data allows
- honest `caveats` (design, sample, setting, outcome, generalisability)

Never propose anything containing patient information.

**Timing:** the blog drafts run at about 3 AM Eastern on Monday, Wednesday and Friday, so entries for a date must be merged by the evening before.

## 2. Rigor review: checking a draft

For each review in the draft, open the primary source and check it against these questions. Reporting guidelines are a useful lens where they apply: CONSORT-AI and SPIRIT-AI for trials, TRIPOD+AI and TRIPOD-LLM for prediction models and language models, STARD-AI for diagnostic accuracy, DECIDE-AI for early clinical evaluation, and CHART for chatbot health-advice studies.

**The study**
1. **Source:** does the link reach the primary source? Is it peer-reviewed or a preprint, and does the draft say which?
2. **Design:** randomized, prospective, retrospective, cross-sectional, simulation, benchmark? Does the draft describe it correctly?
3. **Population and setting:** who, where, how many? Are the clinicians and cases representative of real practice?
4. **Comparison:** what exactly was compared?
    - AI alone vs clinicians
    - clinicians with vs without AI
    - an effect on clinicians' skill

   Are the clinicians a fair comparator (experience, time allowed, information available)?
5. **Outcome:** what was measured? Exam or vignette accuracy, diagnostic accuracy on real cases, patient outcomes, or perceptions? Was it pre-specified, and who judged it?
6. **Size and statistics:** sample size and effect size with a confidence interval where given; multiple comparisons; whether a "difference" is statistically and clinically meaningful.
7. **Bias and validity:**
    - Could the model have seen the test material?
    - Were vignettes selected, or were cases consecutive?
    - Were assessors blinded?
    - Which model and version, and when was it tested?
    - Funding and conflicts of interest.

**The draft**

8. **Verdict:** does it match the study? Use the shared set in CLAUDE.md ("Verdicts"):
    - Never `ai_ahead` for a with/without-AI study.
    - `mixed` when results split across outcomes.
    - `comparable` only when the study supports equivalence, not merely "no significant difference" in an underpowered study.
9. **Claims:**
    - Does every number in the summary appear in the source?
    - Does "Why it matters" follow from the data, without overreach (benchmark results presented as clinical benefit, association as causation, one setting as universal)?
    - Are the main limitations stated?
10. **Living review only:** does each `[S#]` citation support the sentence it is attached to? Are uncited sentences (listed at the top of the PR) acceptable?
11. **Safety:** no patient information, nothing that reads as treatment advice, and the educational disclaimer intact.

## 3. The report

One comment on the pull request:

- **For each problem:**
    - severity: *blocking* (factually wrong, wrong verdict, unsupported claim, missing primary source, PHI) / *should fix* (missing limitation, overstated wording) / *note*
    - which review and which sentence
    - what the source actually says, quoted or with page and section
    - the suggested correction
- **A rigor rating per review:** high / moderate / low confidence in the evidence, with one line on why.
- **A verdict:** *no blocking findings* or *changes needed*.

The report informs the clinical reviewer. It never counts as their approval, and the reviewer never edits the draft itself.

## 4. When to run it

- Every blog draft PR and every AI vs Physician edition PR, before the owner merges it.
- Drafts are opened by `github-actions[bot]`, so request the review on the PR if it doesn't start on its own.
- Friday drafts go first: merging before about 5 PM Eastern puts the post in that week's digest.

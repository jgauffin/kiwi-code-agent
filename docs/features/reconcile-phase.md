# Reconcile phase

A session mode that compares an approved spec with the code and rules on every disagreement.

- Starts from a plan session's spec; refuses a spec whose `status` is not `approved`.
- Tools: Read, Glob, Grep over the whole workspace; writes only `plan/<feature>.plan.md`.
- Input is the spec and the repo. It never sees the plan session's transcript.
- Output `plan/<feature>.plan.md` with front-matter `feature`, `spec`, `status: draft`, and one verdict per spec item, keyed by the spec's stable ids: `matches`, `drifted` (code is wrong, correct it), `naive` (spec is wrong, reason required), `conflict` (sources disagree, human decides).
- Authority order fixed in the prompt: work item, then intent docs, then code. Code is the presumed-wrong party.
- Every `drifted` verdict becomes a work item in the plan alongside the feature's tasks, with the files it concerns.
- `naive` verdicts are listed under an Amendments section as concrete spec changes, for the human to apply or reject; the phase never edits the spec.
- The plan bar shows the plan's status with Open and Approve; approval sets `status: approved`.
- Session status while working is `planning`; a finished turn is `needs_human`.
- Verdict counts per kind are shown in the transcript summary line.

Not included: applying amendments automatically, ADO write-back, retrieval sub-sessions.

# Reconcile phase

A check of a draft spec against the code, run under the plan session from the plan bar.

- Runs as a child of the plan session: no tab, no transcript in the chat. The plan bar shows one line (the current tool call or message) and a Stop; afterwards `Checked: N findings`, `Checked: the code is clear` or the error, until the next check.
- Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill over the whole workspace; Edit/Write on `plan/<feature>.spec.md` and `plan/<feature>.intent.md` only.
- Input is the spec and the repo. It never sees the plan session's transcript and does not browse `docs/**`: the spec is the intent, and an item's citation (`B2 (docs/intent/orders.md#Cancellation)`) is what it opens to quote intent in a contradiction.
- Output: a `## Findings` table in the spec with the columns Finding and Proposed solution. A finding is a `contradiction` (code says otherwise, human decides), a `breakage` (existing behaviour the feature changes, unmentioned) or `naive` (the spec assumes something the code disproves). Ids are stable; a re-run appends `[resolved]` to findings that no longer hold.
- `naive` findings, and contradictions ruled in the spec's favour, are recorded as intent amendments in `plan/<feature>.intent.md` for the human to apply.
- When the run ends with findings that have no proposal, the plan session is told their ids and fills in Proposed solution for each; it changes no item until the user rules. Rulings go through the review (comments and strikes on F-ids) or chat, to the plan session.
- The plan tab's status is the check's while it runs; the Sessions view does not list the check.

Not included: permission prompts from a check (reads are auto-allowed, in-scope writes pass the guard), retrieval sub-sessions.

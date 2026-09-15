# Reconcile phase

A mapping of a draft spec against the code, run under the plan session from the plan bar: what stands in the feature's way, then what to build and where.

- Runs as a child of the plan session: no tab, no transcript in the chat. The plan bar shows one line (the current tool call or message) and a Stop; afterwards `Mapped: N tasks, 2 findings`, `Mapped: N tasks, the code is clear`, `Mapping failed: ...` or `Mapping stopped`, until the next run.
- Offered as "Map against code" on a spec nobody has commented on. After that it runs by itself: when the last comment of a review is accepted, and when a plan turn leaves the board stale with no finding open. A re-map continues the last run's conversation where the engine resumes, told that the spec changed; on an engine without resume it is a fresh run.
- Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill over the whole workspace; Edit/Write on `plan/<feature>.spec.md`, `plan/<feature>.tasks.md` and `plan/<feature>.intent.md` only.
- Input is the spec and the repo. It never sees the plan session's transcript and does not browse `docs/**`: the spec is the intent, and an item's citation (`B2 (docs/intent/orders.md#Cancellation)`) is what it opens to quote intent in a contradiction.
- Authority order when sources disagree: the intent docs, then the code. The code is the presumed-wrong party but also where the users' current reality lives, so a contradiction is reported, not resolved.

First output, the findings:

- A `## Findings` table in the spec with the columns Finding and Proposed solution; nothing else in the file changes. A finding is a `contradiction` (code says otherwise, human decides), a `breakage` (existing behaviour the feature changes, unmentioned) or `naive` (the spec assumes something the code disproves). An empty list is a valid result: silence on an item means the code accommodates it.
- Ids are stable; a re-run keeps findings that still hold and appends `[resolved]` to those that no longer do.
- `naive` findings, and contradictions ruled in the spec's favour, are recorded as intent amendments in `plan/<feature>.intent.md` for the human to apply. The run never edits `docs/`.
- When the run ends with findings that have no proposal, the plan session is told their ids and fills in Proposed solution for each; it changes no item until the user rules. Rulings go through the review (comments and strikes on F-ids) or chat, to the plan session.

Second output, the task board:

- `plan/<feature>.tasks.md`, written with Write: one task per scenario by default, in build order, each naming the spec items it delivers, the files it touches (existing paths, or `(new)`) and the context it was read from. Every behaviour and edge case is delivered by some task; an item no task delivers is a gap the user sees.
- No task for what a finding puts in question: the user rules first, and the finding says what the task would be.
- Task ids are stable: a re-run updates a task that still holds, appends `[removed]` to one that no longer applies and adds new ones with new ids. The implementer's markers (`[in progress]`, `[done]`, `[tested]`, `[blocked: ...]`) and `proves:` lines are left alone, as are the file's front matter and its `## Verification` section.
- The board is stamped with the fingerprint of the spec it was built from, so a later change to the plan shows it as stale and triggers a re-run.
- A `## Tasks` section left in the spec from before the board existed is deleted once the board holds its content.

The plan tab's status is the run's while it works; the Sessions view does not list it.

Not included: permission prompts from a run (reads are auto-allowed, in-scope writes pass the guard), retrieval sub-sessions.

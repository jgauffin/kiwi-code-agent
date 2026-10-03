---
name: feature-status
description: Where a planned feature stands, read from its spec and working files. Use when the user asks whether a feature planning session is done, how far a feature has come, what it is waiting on, which features are planned, or anything about `specs/*.spec.md` and `.kiwi/specs/`.
---

# Feature status

A feature planning session keeps no state of its own that you can see. Where the feature stands
is derived from its files every time, and the plan view does the same, so reading them answers
the question as the extension would.

## Files

`<slug>` is the feature name lower-cased with runs of other characters turned into `-`. List
`specs/*.spec.md` when unsure; the spec's `feature:` line holds the name as the user wrote it.

- `specs/<slug>.spec.md`: the spec, committed. Frontmatter `status:` is `draft`, `approved` or
  `implemented`.
- `.kiwi/specs/<slug>.review.md`: comment rounds on the draft. Under each comment,
  `- addressed:` / `- disagreed:` is the planner's answer and `- resolved` means the user closed it.
  `- remove:` lists struck rules.
- `.kiwi/specs/<slug>.decisions.md`: what the check of the approved spec against the code found.
  One `### Title` per decision; a heading ending `[applied]` or `[withdrawn]` is settled, one with a
  `- ruling:` line awaits the planner, one without awaits the user.
- `.kiwi/specs/<slug>.tasks.json`: the task board. Each task has `state` (`open`, `in_progress`,
  `done`, `tested`, `blocked` with `blockedReason`) and `removed`; a `tested` task with `accepted`
  was accepted by the user while blocked, untested, for the reason it holds. `verification[0]` is
  the newest test run, `ok` its outcome; an empty `runs` means no test command applied, so no tests
  ran. Read it with JsonQuery rather than whole.

The working files under `.kiwi/specs/` are deleted a week after a verified feature was last
touched, once its spec is marked `implemented`. A missing working file therefore means either
"not reached yet" or "swept after finishing"; the spec's status tells which.

## Stage

Take the first that holds:

1. No spec: not planned (or a different slug).
2. `status: implemented`: **done**.
3. `status: draft`:
   - a comment with no answer, or a struck rule the spec still lists: under review, the planner owes a revision;
   - every comment answered but some not `resolved`: the user reads the revision and closes or comments again;
   - otherwise: ready for the user to approve.
4. Approved, no board:
   - a decision not `[applied]`/`[withdrawn]`: the user rules on it (no `ruling:`) or the planner applies rulings;
   - otherwise: the check against the code is running or due.
5. Board with a live (not `removed`) task that is not `tested`: under development. Name blocked tasks and their reasons; when only blocked tasks are left, they wait for the user to hand back or accept.
6. Every live task `tested`, `verification[0].ok` not true: verification pending or failing.
7. Every live task `tested` and `verification[0].ok`: **done**. Say so when tasks were accepted untested or no tests ran.

"Is it done" means stage 2 or 7. For anything else, say the stage and who it waits on: the user or
the planner/implementer.

## What the files do not say

Whether a session's turn is running right now, or waiting on a question or a permission prompt,
lives in the extension, not on disk. Say so when it matters and point the user to the feature's
entry in the Sessions view, which shows it and opens the plan when clicked.

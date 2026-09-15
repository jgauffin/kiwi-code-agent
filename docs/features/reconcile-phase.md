# Reconcile phase

A mapping of a draft spec against the code, run under the plan session from the plan bar: what stands in the feature's way, then what to build and where.

- Runs as a child of the plan session: no tab, no transcript in the chat. The plan bar shows one line (the current tool call or message) and a Stop; afterwards `Mapped: N tasks, 2 decisions`, `Mapped: N tasks, the code is clear`, `Mapping failed: ...` or `Mapping stopped`, until the next run.
- Offered as "Map against code" on a spec nobody has commented on. After that it runs by itself: when the last comment of a review is resolved, and when a plan turn leaves the board stale with no decision pending. A re-map continues the last run's conversation where the engine resumes, told that the spec changed; on an engine without resume it is a fresh run.
- Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill over the whole workspace; Edit/Write on `plan/<feature>.spec.md` and `plan/<feature>.tasks.md` only.
- Input is the spec and the repo. It never sees the plan session's transcript and does not browse `docs/**`: the spec is the intent, and a rule's citation (`(docs/intent/orders.md#Cancellation)` after its text) is what it opens to quote intent in a contradiction.
- Authority order when sources disagree: the intent docs, then the code. The code is the presumed-wrong party but also where the users' current reality lives, so a contradiction is reported, not resolved.

First output, the decisions:

- A `## Decisions` section in the spec, one `###` per decision titled by the disagreement, with an `on` line naming the rules it concerns and a `finding` line saying what the code does, where, and what the spec says; nothing else in the file changes. What the run looks for: a rule the code contradicts, existing behaviour the feature would break unmentioned, an assumption the code disproves. An empty section is a valid result: silence on a rule means the code accommodates it.
- Titles are stable; a re-run keeps decisions that still hold and appends `[withdrawn]` to those that no longer do.
- When the run ends with decisions that have no proposal, the plan session is told their titles and adds a `proposed` line under each: how the rules should change, or why they stand, with the reason. It changes no rule until the user rules.
- The user rules on the plan view's Decisions tab: Accept proposal writes `ruling: accepted`, Rule otherwise writes the user's own text. Nothing is sent. Send rulings, on the plan bar, rules every remaining proposal accepted and hands all rulings to the plan session, which revises the rules per each ruling, marks the decision `[applied]` and records intent amendments in `plan/<feature>.intent.md` where a ruling settles what intent does not say. The board is re-mapped when that turn ends; Approve is refused until then, so the user approves the revised spec.

Second output, the task board:

- `plan/<feature>.tasks.md`, written with Write: one task per scenario by default under a `##` heading with the scenario's title, in build order, each a named bold lead-in listing the rules it delivers, the files it touches (existing paths, or `(new)`) and the context it was read from. A foundation every scenario needs sits under `## Foundation`, first. Every rule and edge case is delivered by some task; a rule no task delivers is a gap the user sees.
- No task for what a pending decision puts in question: the user rules first, and the finding says what the task would be.
- Task names are stable: a re-run updates a task that still holds, appends `[removed]` to one that no longer applies and adds new ones. The implementer's markers (`[in progress]`, `[done]`, `[tested]`, `[blocked: ...]`) and `proves:` lines are left alone, as are the file's front matter and its `## Verification` section.
- The board is stamped with the fingerprint of the spec it was built from, so a later change to the plan shows it as stale and triggers a re-run.
- A `## Tasks` section left in the spec from before the board existed is deleted once the board holds its content.

The plan tab's status is the run's while it works; the Sessions view does not list it.

Not included: permission prompts from a run (reads are auto-allowed, in-scope writes pass the guard), retrieval sub-sessions.

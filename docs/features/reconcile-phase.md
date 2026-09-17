# Reconcile phase

A mapping of a draft spec against the code, run under the plan session from the plan bar: what stands in the feature's way, then what to build and where.

- Runs as a child of the plan session: no tab, no transcript in the chat. The plan bar shows one line (the current tool call or message) and a Stop; afterwards `Mapped: N tasks, 2 decisions`, `Mapped: N tasks, the code is clear`, `Mapping failed: ...` or `Mapping stopped`, until the next run.
- Offered as "Map against code" on a spec nobody has commented on. After that it runs by itself: when the last comment of a review is resolved, and when a plan turn leaves the board stale with no decision pending. A re-map continues the last run's conversation where the engine resumes, told that the spec changed; on an engine without resume it is a fresh run.
- Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill over the whole workspace; Edit/Write on `plan/<feature>.decisions.md` and `plan/<feature>.tasks.md` only. The spec is never the mapper's to write.
- Input is the spec and the repo. It never sees the plan session's transcript and does not browse `docs/**` or the other specs: the spec is the intent, and a rule's citation (`(docs/intent/orders.md#Cancellation)` after its text) is what it opens to quote intent in a contradiction.
- Authority order when sources disagree: the docs and the approved specs, then the code. The code is the presumed-wrong party but also where the users' current reality lives, so a contradiction is reported, not resolved.

First output, the decisions:

- `plan/<feature>.decisions.md`, one `###` per decision titled by the disagreement, with an `on` line naming the rules it concerns and a `finding` line of one or two sentences: what the code does, at the one path and symbol that shows it, and what the spec says; not how it was found, not what the spec should say instead. What the run looks for: a rule the code contradicts, existing behaviour the feature would break unmentioned, an assumption the code disproves. An empty file is a valid result: silence on a rule means the code accommodates it. The spec holds no finding, so a later planner reading it sees rules, never paths.
- Titles are stable; a re-run keeps decisions that still hold and appends `[withdrawn]` to those that no longer do. A decision ruled `keep` is settled: the code changes, the task that touches it says so in `how:`, and the finding is not reported again.
- When the run ends with decisions that have no proposal, the plan session is told their titles and adds one to three `proposed` lines under each: distinct ways to settle it, each the rule's new text as it would stand in the spec. Keeping the rule is not proposed; the wizard offers it. The planner changes no rule until the user rules.
- The user rules in the wizard on the plan view's Decisions tab, one decision at a time: change the spec one of the proposed ways, keep the spec (the code changes), or an own ruling in the user's words. A pick writes the `ruling` line and moves on to the next open decision; nothing is sent. Send rulings, on the plan bar, needs every decision ruled and hands the rulings to the plan session, which revises the rules per each ruling (a proposal's text replaces the rule verbatim; `keep` moves nothing; own words are worked in) and marks the decision `[applied]`. The board is re-mapped when that turn ends; Approve is refused until then, so the user approves the revised spec.

Second output, the task board:

- `plan/<feature>.tasks.md`, written with Write: one task per scenario by default under a `##` heading with the scenario's title, in build order, each a named bold lead-in with a one-sentence line for the person, listing the rules it delivers, the files it touches (existing paths, or `(new)`), the context it was read from and a `how:` block for the implementer: the steps, the symbols to change, the pattern to follow. A foundation every scenario needs sits under `## Foundation`, first. Every rule and edge case is delivered by some task; a rule no task delivers is a gap the user sees.
- No task for what a pending decision puts in question: the user rules first.
- Task names are stable: a re-run updates a task that still holds, appends `[removed]` to one that no longer applies and adds new ones. The implementer's markers (`[in progress]`, `[done]`, `[tested]`, `[blocked: ...]`) and `proves:` lines are left alone, as are the file's front matter and its `## Verification` section.
- The board is stamped with the fingerprint of the spec it was built from, so a later change to the plan shows it as stale and triggers a re-run.

The plan tab's status is the run's while it works; the Sessions view does not list it.

Not included: permission prompts from a run (reads are auto-allowed, in-scope writes pass the guard), retrieval sub-sessions.

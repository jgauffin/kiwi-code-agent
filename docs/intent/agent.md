# Agent definition

## Why

Blind planning exists because a planner that can read the code inherits the code's mistakes as constraints. Every workaround becomes an implicit requirement, and the feature gets shaped to fit the defect. Deriving the spec from intent alone makes disagreement between intent and implementation visible rather than silently absorbed. Phase 2 is not "soften the spec until it fits"; it is "name each disagreement and rule on it", with the code as the presumed-wrong party.

## Engines

A session runs on one engine, chosen per session or per phase:

- Claude through the Agent SDK (Claude Code as a library, JavaScript build, inherited Claude Code login).
- GLM-5.3-Flash and Kimi K3 through Berget AI (OpenAI-compatible) with our own loop and tools.

The extension only sees `CodeSession`: send a prompt, stream events, answer permission requests, interrupt. Engines differ below that line.

## Shape

Three phases, each a session with its own system prompt and tool set. The state is files on disk: a phase can always start from them. Blindness is the boundary: nothing that has seen the code reaches the plan session as conversation. Below it a phase continues the conversation of the phase before it where the engine resumes, so what was read is not read again: a re-map continues the last mapping run, the first implement session continues the mapping run that wrote the board, a later implement prompt continues the last implement session, and the cleanup run continues the implement session that wrote the files. Planning produces the spec, approved once; mapping is part of planning and writes its decisions into the spec and the tasks into a file of their own.

```
docs/intent/**  +  work item  →  spec.md  →  spec.md + decisions, tasks.md  →  approved spec  →  code  →  tests pass
                    (blind)                  (map against code)                               (implement)  (verification)
```

Nothing in the plan files is a synthetic id. A rule, a task and a decision are named, the way a test or a function is named, and the name is the anchor everything else refers to: a comment names the rule it is on, a task names the rules it delivers, a proof names the rule a test proves, a decision names the rules it concerns. Names are stable; a rename carries a `(was Old name)` note the extension follows through every file.

### Stages

Where a feature stands is derived from its files under `plan/` and held nowhere else, so the stage and the files can never disagree. The plan view adapts to it: a stepper (Plan, Review, Map, Rule, Approve, Implement, Verify, Intent) marks the step the stage asks of the person, and the bar beneath it states the one next thing: a button when it moves the plan on (Map against code, Submit review, Send rulings, Approve, Implement, Verify, Update intent), a link into the plan view when the act is on a row there (answers to resolve, decisions to rule on), a line of text while the planner or a run is at work. The plan itself is tabs, each present once it has content: Spec (the goal, scenarios and questions, commented on in place), Review (the rounds, with the planner's answers and Resolve), Decisions, Tasks and Intent. A reached step on the stepper opens the tab it works in; Review stays reachable on any draft, nothing past approval.

| stage | derived from |
|---|---|
| created | spec is `draft`, no review in flight, no tasks file |
| under review | comments or strikes are being written, or the planner has yet to answer them |
| final draft | every comment is answered; the human reads the revised spec and accepts, or comments again |
| mapped | no open comment, `tasks.md` exists, no task marker yet; Approve is offered here, on a draft |
| under development | approved, at least one task marker, not every task `[tested]` |
| verification | every task `[tested]`; the test commands have yet to pass |
| verified | every task `[tested]` and the last recorded run passed |

Resolving the last open comment maps the spec against the code by itself; a spec nobody commented on is mapped from the plan bar.

A session that is picked up after its engine stopped is set up afresh: it carries the conversation it had, and the instructions and generated context a session starting now would get.

## Phase 1: Blind plan

Sees: feature description, domain brief (ubiquitous language, stack, constraints), `docs/intent/**`, one work item closure when ADO is connected.
Never sees: source, descriptive docs, PRs, build output.

Until ADO is connected the feature description is typed by the user or picked from `docs/intent/**`. The agent plans the user story itself; the tasks file is the source for the ADO tasks created under the story once ADO is connected (write-back, not read-only).

Tools: Read/Glob scoped to `docs/intent/**`, `get_work_item(id)`, AskUserQuestion, optionally WebSearch. Bash denied by bare name (allow-lists only auto-approve; a bare-name deny removes the tool from context).

First a direction in chat (the decisions that shape the feature, the questions that would change them); nothing is written until the user says go. Then `plan/<feature>.spec.md`, to the contract below. A rule derived from intent ends with a citation of its section (`(docs/intent/orders.md#Cancellation)`); an uncited rule is the planner's default. To the point, not complete: a rule earns its place by changing what gets built or how it is tested. No code paths. If `docs/intent/**` has nothing on the feature, ask and stop.

### The spec contract

```markdown
## Goal
Prose.

## Cancelling an order            ← a scenario: a situation from the user's side
- **Cancel command**: a rule, written so a test can prove it (docs/intent/orders.md#Cancellation)
  - **Shipped order**: situation → outcome, an edge of the rule above
- **Refund on cancel**: another rule

## Open questions
- **Partial refunds**: what only the user can settle

## Decisions
### Shipped orders cannot be cancelled
- on: Cancel command
- finding: what the code does, where, and what the spec says
- proposed: how the rules should change, or why they stand
- ruling: accepted
```

`Goal`, `Open questions` and `Decisions` are reserved; every other `##` is a scenario, and a small feature has one. Rules sit directly under a scenario; an edge case is nested under the rule it qualifies, one level, no deeper. Every rule, edge case and question is named by the bold lead-in of its line, unique in the spec; the name never changes once written, a rename carries `(was Old name)` after the new one. There are no invariants, acceptance criteria or task sections: an invariant is a rule, an acceptance criterion restates one, and the evidence that a rule holds is the test the implementer names for it. The extension parses the spec into this model on every write and hands what does not fit back to the model on the same tool result; the plan view shows the problems and offers Repair, which runs the migration (below) for that plan.

### get_work_item

Hand-coded, read-only, Azure DevOps. Server-side filtering is the enforcement.

- Include: title, description, parent chain, Goal/Actor/Impact/Behaviour/Example.
- Exclude: state, comments, tasks, linked PRs/commits/branches/builds, `System.*` and `Microsoft.VSTS.*` fields.
- Walks parents, children, related. Depth and total caps, cycle detection, deterministic ordering. Returns markdown. Snapshot to `plan/<feature>.context.md`.
- State is excluded deliberately: a Done item over drifted code is evidence for phase 2, not input to phase 1.
- Prose may leak file paths; accepted, or stripped in the tool.

### Docs split

`docs/intent/**` is phase 1 scope. Everything else is phase 2 only. Descriptive docs drift with the code in the same direction and arrive labelled as authority.

## Phase 2: Map against code

Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill; Edit and Write on the spec and its tasks file only. Bash denied by bare name.
Input: spec + context + repo. Not the phase 1 transcript, and not `docs/**`: the spec is the intent for this feature, and the citations on its rules are what the check opens when it needs intent's exact words.

A run, not a session: started from the plan bar, it runs under the plan session's tab with no tab or transcript of its own, only a one-line progress indicator in the plan bar and a stop. It ends when its turn ends; a re-check is a new run. Its full transcript is in the run log for inspection.

The job is to find what stands in the feature's way before implementation starts, not to grade the spec. Only disagreements are reported, each as a decision for the user; a rule the code accommodates without incident is not mentioned. An empty list is a valid result. What the run looks for: a business rule in the code that says otherwise (the human decides which side is right), existing behaviour the feature would change or break that the spec does not mention, and something the spec assumes that the code shows to be wrong.

Output, two files. A `Decisions` section in the spec, one `###` per decision titled by the disagreement, with an `on` line naming the rules it concerns and a `finding` line naming the code it rests on, short enough to read in one sitting. The run writes titles, `on` and `finding` only. When the run ends with decisions that have no proposal, the plan session is handed their titles and adds a `proposed` line under each: how the rules should change, or why they stand, with the reason.

The user rules in place, on the plan view's Decisions tab: Accept proposal writes `ruling: accepted`, Rule otherwise writes the user's own words; nothing is sent. Send rulings, from the plan bar, rules every remaining proposal accepted and hands all rulings to the plan session, which revises the rules per each ruling, marks the decision `[applied]` and records intent amendments where a ruling settles what intent does not say. Approve is refused while a decision is pending: the user approves what the planner wrote, not what it proposed. A decision the mapper finds no longer holds on a re-run is marked `[withdrawn]`.

And `plan/<feature>.tasks.md`: one task per scenario by default under a `##` heading with the scenario's title, departing only for a reason the task names (a scenario too big for one sitting is split in build order; a foundation every scenario needs is one task under `## Foundation`, first). Each task is a named bold lead-in listing the rules it delivers in parentheses and the files it touches on an indented `files:` line (existing paths; `(new)` for ones to create); every rule and edge case is delivered by some task, and a rule no task delivers shows as a gap. Task names are stable across re-runs: a re-run keeps, updates or marks `[removed]`, never renames. No task is written under a decision still pending. A legacy `## Tasks` section in the spec is deleted once the board holds it.

```markdown
---
spec: 3f9a1c2e
---
## Cancelling an order
- **Cancel command** (Cancel command, Shipped order): add the cancel command
  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)
  - context: src/orders/order.ts, src/orders/ship.test.ts
```

`context:` is what the run read to arrive at the task (the modules the files lean on, the test showing the pattern, where the term already lives), so an implementer that does not have the mapper's conversation starts from `files:` and `context:` and searches only for what they do not answer.

The front matter records the fingerprint of the spec the board was mapped from (goal, scenarios and questions; not decisions, so a proposal or a ruling does not count). A plan turn that changes the spec under a mapped board makes it stale: the plan bar says so, approval is refused, and the board is re-mapped when a plan turn ends with no decision pending; a board mapped under a pending decision would carry no task for what it questions and go stale on the revision. Mapping is offered as a button only on a spec nobody has commented on; after that it runs by itself.

Authority order is fixed in the prompt: work item, then intent doc, then code. What a ruling settles that intent does not say is written back to `docs/intent/**` or the work item as an explicit output, so intent does not rot.

### Intent write-back

Phase 1 is blind: it reads `docs/**` and nothing else. A ruling that lives only in a spec is therefore invisible to the next feature's planner, which will re-derive the same question and may settle it the other way. So what a feature settles has to reach the docs it was planned from.

The agent never edits `docs/`: intent is the user's. The plan session proposes, in `plan/<feature>.intent.md` when it applies a ruling, one section per amendment: the doc and heading it lands in and the mode as the heading, where it came from and why, then the text as intent would read it.

```markdown
## docs/intent/orders.md#Cancellation (append)
- from: Reservations are released by a job, ruled for the spec
- why: intent does not say what happens to the reservation.

Cancelling an order releases its reservation immediately.
```

The modes are `append` (add to the section), `replace` (rewrite its body) and `new` (add a section, or a document). An amendment is identified by its heading. The plan scope makes that file writable; `docs/**` stays read-only to every phase.

Applying is the human's act, from the plan bar, and mechanical: the extension writes each pending amendment into its document and appends `[applied]` to it, so nothing is written twice and what lands in `docs/` is what was proposed, reviewable as a git diff. It is offered on an approved spec only — on a draft the rulings can still change — and stays offered after the feature is built, which is when a spec that named no amendments is worth a second look. An amendment that cannot be applied (no such heading, a path outside `docs/`) is reported and stays pending; the others still go through.

## Retrieval

A sub-session the planner calls with `retrieve(question, known, budget)` to keep file dumps out of its own context. Phase 2 first; phase 1 only when the intent tree or work-item graph outgrows the planner.

- Locates and quotes, never interprets. Output is verbatim excerpts with provenance; the planner rules on them. A summary drops nuance silently, and the planner never sees what was left out.
- Tools are derived, not configured: the calling phase's tool set minus AskUserQuestion and anything that writes. Phase 1 retrieval is blind by construction.
- No user interaction, no recursion. "Needs X to answer" goes in `not_found`; the planner decides whether to ask. Depth 1.
- Result: `findings[]` (excerpt, source as `path#heading`, work item id or URL, one line on why it matches), `not_found[]` (what was looked for, where), `status: complete | partial | budget_exhausted`. Partial is a result, not an error.
- Written to `.agent/runs/<id>/retrieval/<n>.md`; the tool returns path, status and counts. Files on disk, not conversation context.
- Budget per call (tool calls, tokens), set by the planner. Exhaustion returns findings so far.
- Runs as a `CodeSession` under its own profile; a cheap model is fine because the task is search.
- Independent questions fan out as independent sessions, no shared state.

## Phase 3: Implement

Tools: Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery, Bash. Input is the approved spec and its tasks file, started from the plan bar as a continuation of the mapping run's conversation where the engine resumes, a fresh session otherwise; refuses to start on `status: draft` or without a tasks file. Implement on a feature that already has an implement session carries that session on. A decision whose ruling says to fix the code is work with the task it touches. Writes go through the ordinary permission prompt; no scope guard.

- Task state is the tasks file: the implementer appends `[in progress]` when it starts a task, `[done]` when the code is written, `[tested]` when every rule the task delivers is proven by a passing test, `[blocked: reason]` when it cannot finish, so task 4 of 7 survives a fresh session and shows in the plan view. The task's `files:` line is kept true to what was touched.
- Coverage is the evidence: a `proves:` line on the task names, per delivered rule, the test file and the test whose name states the rule (`proves: Cancel command → test/orders/cancel.test.ts an_open_order_can_be_cancelled, Shipped order → ...`). The plan view shows on each rule and edge case which task delivers it and which test proves it, or `no task` / `no test`; a task marked tested with a rule it names no test for is flagged. That is what an acceptance section used to promise, made checkable.
- Only `[tested]` is a finish. A board whose every task is tested goes to verification; the plan bar stops offering Implement, since a second session would re-read the code and decide for itself what to redo. `[blocked: reason]` is unfinished work, so it still takes a fresh session. The state is derived from the markers, not a `status` of its own: adding a task to a finished board makes it unfinished again with nothing to reset, and the two can never disagree.

## Migration

`KiwiAgent: Migrate plans` brings every plan under `plan/` to the contract; Repair in the plan bar does it for one. By rule first: a legacy `## Tasks` section becomes the tasks file (delivered rules first, markers kept), id-shaped lines in every file become the named shapes with the old id standing in as the name (a findings table becomes decisions titled by their ids), the board is stamped, the intent file is parsed and a broken one reported. What remains (invariants, acceptance criteria, flat edge cases, rules still named by an id) goes to the plan session as a prompt: group into scenarios, nest edges, fold restated rules, give each rule a real name, and mark one that survives under a new name with `(was I3)`. When that turn ends the extension follows each rename through the review targets, the tasks' delivered rules and the decisions, drops the notes and stamps the board. Approval is kept on a migrated approved spec: the arrangement changed, not the rules.

## Verification

Mechanical, no model: once every task is `[tested]`, the extension runs the `kiwiAgent.verify` rules over the files the tasks name. A rule is a file glob, a project marker and a command (`**/*.cs` with `*.csproj` runs `dotnet test` in that project; `src/**/*.ts` with `package.json` runs `npm test` there), so a feature that touched only the backend runs only the backend's tests, and a repo with a backend and a frontend bundle runs each once. The outcome is recorded under `## Verification` in the tasks file, newest first; the output tail goes to the run log. A failure is handed to the implement session (the live one for the feature, or a fresh one) with the command and its output; the run repeats when the board is all tested again, up to `kiwiAgent.verifyFailureBudget` consecutive failures, after which the failed record stays for the user. Verify again is offered from the plan bar.

Parked: build scoped to the project owning the edited file; read-before-edit staleness enforced in a hook rather than by prompt.

## Instructions

Small shared core plus a per-phase file. Per-type rules inject via PreToolUse hook matched on the path at edit time.

- Checkable rules (no `#region`, no AutoMapper/MediatR, nullable on, no `Any`) go to analyzers, `.editorconfig`, BannedApiAnalyzers, grep in the verification hook.
- Judgment rules (rule of three, earned abstraction) go to the prompt.
- A phase file over a page means the excess is checkable or is spec. Remove alternatives instead of instructing tool preference.

### Skills

`.claude/skills/<name>/SKILL.md` and `.agent/skills/<name>/SKILL.md`, Claude Code's layout, so one skill serves both engines; `.agent/skills` wins on a shared name. The index (name and description from the frontmatter) rides in the `Skill` tool's description; the model loads a skill itself when a task matches, and the tool returns the body with the skill's folder for relative paths. Phases 2 and 3 and chat carry the tool; the blind planner does not, since skills describe how code is written.

## Coordination

Claim registry `.agent/sessions/<id>.json`: claimed files, `plan_item_id`, `deadline` set by the session, heartbeat. PreToolUse hook on Edit/Write claims on first touch, denies if another live session holds the file and names who.

- Session reports completion and releases the claim. Silence past `deadline` is the stale signal.
- Stale claims are flagged in the UI, never auto-released.
- Force-release posts a revocation message into the session. The session stops immediately, does not finish the in-flight edit, reports touched files.

Checkpoints, opt-in: `checkpoint(reason)` scoped to files under the session's claims; `revert` hash-compares and refuses files that moved underneath. No git. Repeated checkpoints on one plan item mean the item was underspecified; log the reasons.

Channels, non-blocking: `send(session, text)` returns immediately; notification is a one-line tail on the receiver's next tool result; `read_messages()` pulls the payload. Registry before channels. Cap thread length and escalate to the user.

## Observability

Run id, per-phase transcript, tool calls, token spend, checkpoint reasons under `.agent/runs/<id>/`.

## Per-phase model

Phase 1 wants the strongest reasoner, phase 3 wants throughput. Profiles carry engine, model and effort.

## Parked

- ADO: `get_work_item` and creating tasks under the user story from the spec's task list. No work items exist yet.
- Repo map for phases 2 and 3 (project list, public type index, folder conventions).
- Anthropic Messages API adapter under API key in the own-loop engine.
- Compaction in the own-loop engine.
- Retrieval in phase 1 (large intent tree, work-item graph, WebSearch).

## Interrupting

Interrupting a session ends the turn it is in. Anything the session was waiting on is abandoned rather than answered, and the session learns how it ended when the person next prompts it.

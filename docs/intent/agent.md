# Agent definition

## Why

Blind planning exists because a planner that can read the code inherits the code's mistakes as constraints. Every workaround becomes an implicit requirement, and the feature gets shaped to fit the defect. Deriving the spec from intent alone makes disagreement between intent and implementation visible rather than silently absorbed. Phase 2 is not "soften the spec until it fits"; it is "name each disagreement and rule on it", with the code as the presumed-wrong party.

## Engines

A session runs on one engine, chosen per session or per phase:

- Claude through the Agent SDK (Claude Code as a library, JavaScript build, inherited Claude Code login).
- Any OpenAI-compatible provider (Berget AI's GLM and Kimi, say) with our own loop and tools.

The extension only sees `CodeSession`: send a prompt, stream events, answer permission requests, interrupt. Engines differ below that line.

Both take the workspace's `.mcp.json`: Claude through its own MCP client, the own loop through a client per server. The tools carry the same names and fall under the same permission rules on either engine, so a project's servers work the same whichever model runs.

## Shape

Three phases, each a session with its own system prompt and tool set. The state is files on disk: a phase can always start from them. Blindness is the boundary: nothing that has seen the code reaches the plan session as conversation. Below it a phase continues the conversation of the phase before it where the engine resumes, so what was read is not read again: a re-map continues the last mapping run, the first implement session continues the mapping run that wrote the board, a later implement prompt continues the last implement session, and the cleanup run continues the implement session that wrote the files. Planning produces the spec, approved once; mapping is part of planning and writes its decisions and its tasks into files of their own, never into the spec.

```
docs/**  +  specs  +  work item  →  spec.md  →  decisions.md, tasks.md  →  revised spec  →  approved spec  →  code  →  tests pass
                                   (blind)      (map against code)        (rulings)                       (implement)  (verification)
```

An approved spec is the feature's definition: rules and edge cases in the product's language, ruled by the user, with no path or symbol in it. The next feature is planned from the specs as much as from the docs, so what one feature settled reaches the next without a step of its own.

Nothing in the plan files is a synthetic id. A rule, a task and a decision are named, the way a test or a function is named, and the name is the anchor everything else refers to: a comment names the rule it is on, a task names the rules it delivers, a proof names the rule a test proves, a decision names the rules it concerns. Names are stable; a rename carries a `(was Old name)` note the extension follows through every file.

### Stages

Where a feature stands is derived from its files under `plan/` and held nowhere else, so the stage and the files can never disagree. The plan view adapts to it. One row is the plan bar: the steps (Plan, Review, Map, Rule, Approve, Implement, Verify) with the one the stage asks of the person lit, and at its right the one next thing: a button when it moves the plan on (Map against code, Submit review, Send rulings, Approve, Implement, Verify), a link into the plan when the act is on a row there (answers to resolve, decisions to rule on), a line of text while the planner or a run is at work. Nothing restates the stage in words. The row under it is one strip of tabs: the plan's, each present once it has content (Spec with the goal, scenarios and questions commented on in place; Review with the rounds, the planner's answers and Resolve; Decisions, one at a time; Tasks), and Chat last. A reached step opens the tab it works in; Review stays reachable on any draft, nothing past approval.

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

Sees: feature description, domain brief (ubiquitous language, stack, constraints), `docs/**`, the workspace README, every feature's spec under `plan/*.spec.md`, one work item closure when ADO is connected.
Never sees: source, PRs, build output, generated context such as the repo map, another feature's review, tasks or decisions.

Until ADO is connected the feature description is typed by the user or picked from the docs. The agent plans the user story itself; the tasks file is the source for the ADO tasks created under the story once ADO is connected (write-back, not read-only).

Tools: Read/Glob scoped to `docs/**`, the workspace README, the specs and the feature's own plan files, `get_work_item(id)`, AskUserQuestion, optionally WebSearch. Bash denied by bare name (allow-lists only auto-approve; a bare-name deny removes the tool from context). A write into `docs/**` is neither the phase's deliverable nor off limits: it goes through the permission prompt, and the planner makes one only when the user asks.

First a direction in chat (the decisions that shape the feature, the questions that would change them); nothing is written until the user says go. Then `plan/<feature>.spec.md`, to the contract below. A rule derived from a doc or another spec ends with a citation of its section (`(docs/intent/orders.md#Cancellation)`, `(plan/orders.spec.md#Cancelling an order)`); an uncited rule is the planner's default. An approved spec weighs as a doc; a draft is a proposal still being planned. Where a doc and an approved spec disagree, the planner asks: the user knows which is current. To the point, not complete: a rule earns its place by changing what gets built or how it is tested. No code paths. If neither the docs nor the specs have anything on the feature, ask and stop.

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
```

`Goal` and `Open questions` are reserved; every other `##` is a scenario, and a small feature has one. Rules sit directly under a scenario; an edge case is nested under the rule it qualifies, one level, no deeper. Every rule, edge case and question is named by the bold lead-in of its line, unique in the spec; the name never changes once written, a rename carries `(was Old name)` after the new one. There are no invariants, acceptance criteria or task sections: an invariant is a rule, an acceptance criterion restates one, and the evidence that a rule holds is the test the implementer names for it. The extension parses the spec into this model on every write and hands what does not fit back to the model on the same tool result; the plan view shows the problems and offers Repair, which runs the migration (below) for that plan.

### get_work_item

Hand-coded, read-only, Azure DevOps. Server-side filtering is the enforcement.

- Include: title, description, parent chain, Goal/Actor/Impact/Behaviour/Example.
- Exclude: state, comments, tasks, linked PRs/commits/branches/builds, `System.*` and `Microsoft.VSTS.*` fields.
- Walks parents, children, related. Depth and total caps, cycle detection, deterministic ordering. Returns markdown. Snapshot to `plan/<feature>.context.md`.
- State is excluded deliberately: a Done item over drifted code is evidence for phase 2, not input to phase 1.
- Prose may leak file paths; accepted, or stripped in the tool.

### Docs split

The whole of `docs/**` and every spec is phase 1 scope. What phase 1 is kept from is the code and what travels with it: source, PRs, build output, generated context, the mapper's files. Those drift with the code in the same direction and arrive labelled as authority.

`docs/**` holds what no spec holds: the domain brief, the constraints, the features not yet planned. Once a spec is approved it is the feature's definition, and the doc it was planned from may say less, or otherwise. Nobody trims that by hand unprompted, so on approval the plan session lists in chat, per doc section, what now reads differently from the spec or is covered by it and can go. The user edits, or tells the planner to, and each of its writes into `docs/**` is confirmed.

## Phase 2: Map against code

Tools: Read, Glob, Grep, JsonSchema, JsonQuery, Skill; Edit and Write on the feature's decisions file and tasks file only. The spec is never the mapper's to write. Bash denied by bare name.
Input: spec + context + repo, the agent's own generated files included: what a build wrote for the run to use is part of what it may read. Not the phase 1 transcript, and not `docs/**` or the other specs: the spec is the intent for this feature, and the citations on its rules are what the check opens when it needs intent's exact words.

A run, not a session: started from the plan bar, it runs under the plan session's tab with no tab or transcript of its own, only a one-line progress indicator in the plan bar and a stop. It ends when its turn ends; a re-check is a new run. Its full transcript is in the run log for inspection.

The job is to find what stands in the feature's way before implementation starts, not to grade the spec. Only disagreements are reported, each as a decision for the user; a rule the code accommodates without incident is not mentioned. An empty list is a valid result. What the run looks for: a business rule in the code that says otherwise (the human decides which side is right), existing behaviour the feature would change or break that the spec does not mention, and something the spec assumes that the code shows to be wrong.

Output, two files. `plan/<feature>.decisions.md`, one `###` per decision titled by the disagreement, with an `on` line naming the rules it concerns and a `finding` line of one or two sentences: what the code does, at the one path and symbol that shows it, and what the spec says; not how it was found and not what the spec should say instead. The run writes titles, `on` and `finding` only. When the run ends with decisions that have no proposal, the plan session is handed their titles and adds one to three `proposed` lines under each: distinct ways to settle it, each the rule's new text as it would stand in the spec. Keeping the rule is not proposed; it is always offered.

```markdown
### Shipped orders cannot be cancelled
- on: Cancel command
- finding: what the code does, at one path and symbol, and what the spec says
- proposed: the rule's new text, one way
- proposed: the rule's new text, another way
- ruling: keep
```

Findings are a temporal state: the spec never holds one, so a later planner reads rules, not paths. The user rules in a wizard on the plan view's Decisions tab, one decision at a time, the finding explained and the ways to settle it as buttons: change the spec one of the proposed ways, keep the spec (the code changes), or an own ruling in the user's words. A pick writes the `ruling` line and moves on to the next open decision; nothing is sent. Send rulings, from the plan bar, needs every decision ruled (with several options there is no default) and hands the rulings to the plan session, which revises the rules per each ruling (a proposal's text replaces the rule verbatim, so the rule stays one sentence; `keep` moves nothing; own words are worked into the rules) and marks the decision `[applied]`. A `keep` ruling is settled work: the re-map writes the code change into the task that touches it and reports the finding no more, and the implementer reads the decisions file for it. Approve is refused while a decision is pending: the user approves what the planner wrote, not what it proposed. A decision the mapper finds no longer holds on a re-run is marked `[withdrawn]`.

And `plan/<feature>.tasks.md`: one task per scenario by default under a `##` heading with the scenario's title, departing only for a reason the task names (a scenario too big for one sitting is split in build order; a foundation every scenario needs is one task under `## Foundation`, first). Each task is a named bold lead-in listing the rules it delivers in parentheses and the files it touches on an indented `files:` line (existing paths; `(new)` for ones to create); every rule and edge case is delivered by some task, and a rule no task delivers shows as a gap. Task names are stable across re-runs: a re-run keeps, updates or marks `[removed]`, never renames. No task is written under a decision still pending. A legacy `## Tasks` section in the spec is deleted once the board holds it.

```markdown
---
spec: 3f9a1c2e
---
## Cancelling an order
- **Cancel command** (Cancel command, Shipped order): add the cancel command
  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)
  - context: src/orders/order.ts, src/orders/ship.test.ts
  - how:
    - add `cancel()` on `Order` beside `ship()`, same guard shape
    - the handler follows src/orders/ship.ts; the test file mirrors src/orders/ship.test.ts
```

The task's line is one sentence, for the person. `context:` is what the run read to arrive at the task (the modules the files lean on, the test showing the pattern, where the term already lives) and `how:` is the instruction built from that reading (the steps, the symbols to change by path and name, the pattern to follow, what not to touch), so an implementer that does not have the mapper's conversation starts from `files:`, `context:` and `how:` and searches only for what they do not answer. The plan view's Tasks tab shows the scenario, each task's state and its files; the rest is the implementer's and stays in the file.

The front matter records the fingerprint of the spec the board was mapped from (goal, scenarios and questions; not decisions, so a proposal or a ruling does not count). A plan turn that changes the spec under a mapped board makes it stale: the plan bar says so, approval is refused, and the board is re-mapped when a plan turn ends with no decision pending; a board mapped under a pending decision would carry no task for what it questions and go stale on the revision. Mapping is offered as a button only on a spec nobody has commented on; after that it runs by itself.

Authority order is fixed in the prompt: work item, then the docs and the approved specs, then code. What a ruling settles reaches the next feature's planner through the approved spec, which it reads; what the docs then say wrongly or twice is listed on approval (see Docs split).

### The mapping run has no voice

The mapping run has no conversation of its own: while it works, the person sees a single line of progress on the plan it runs under. What it cannot settle it writes down as a finding for the person to rule on, and never asks.

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

Tools: Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery, Bash. Input is the approved spec, its tasks file and its decisions file, started from the plan bar as a continuation of the mapping run's conversation where the engine resumes, a fresh session otherwise; refuses to start on `status: draft` or without a tasks file. Implement on a feature that already has an implement session carries that session on. A decision ruled `keep` is work with the task it touches. Writes go through the ordinary permission prompt; no scope guard. An implement session may write anywhere the user allows, generated files included: what protects generated output is that the next build rewrites it wholesale, so an edit into it is lost, not refused.

- Task state is the tasks file: the implementer appends `[in progress]` when it starts a task, `[done]` when the code is written, `[tested]` when every rule the task delivers is proven by a passing test, `[blocked: reason]` when it cannot finish, so task 4 of 7 survives a fresh session and shows in the plan view. The task's `files:` line is kept true to what was touched.
- Coverage is the evidence: a `proves:` line on the task names, per delivered rule, the test file and the test whose name states the rule (`proves: Cancel command → test/orders/cancel.test.ts an_open_order_can_be_cancelled, Shipped order → ...`). The plan view shows on each rule and edge case which task delivers it and which test proves it, or `no task` / `no test`; a task marked tested with a rule it names no test for is flagged. That is what an acceptance section used to promise, made checkable.
- Only `[tested]` is a finish. A board whose every task is tested goes to verification; the plan bar stops offering Implement, since a second session would re-read the code and decide for itself what to redo. `[blocked: reason]` is unfinished work, so it still takes a fresh session. The state is derived from the markers, not a `status` of its own: adding a task to a finished board makes it unfinished again with nothing to reset, and the two can never disagree.

## Migration

`KiwiAgent: Migrate plans` brings every plan under `plan/` to the contract; Repair in the plan bar does it for one. By rule first: a legacy `## Tasks` section becomes the tasks file (delivered rules first, markers kept), a `## Decisions` section or a findings table becomes the decisions file (a table's rows titled by their ids), id-shaped lines in every file become the named shapes with the old id standing in as the name, the board is stamped. What remains (invariants, acceptance criteria, flat edge cases, rules still named by an id) goes to the plan session as a prompt: group into scenarios, nest edges, fold restated rules, give each rule a real name, and mark one that survives under a new name with `(was I3)`. When that turn ends the extension follows each rename through the review targets, the tasks' delivered rules and the decisions, drops the notes and stamps the board. Approval is kept on a migrated approved spec: the arrangement changed, not the rules.

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

The model a phase runs on is chosen per feature, one profile per phase, and held as the user's own preference beside the feature rather than in its plan files: it is a way of working, not part of what the feature is, and it never changes the stage a feature is at.

A chat session's model is chosen on the session and can be changed while the conversation is in play; it is independent of any feature's phase choices. Where nothing is chosen, the settings default stands.

## Waiting for the person

A plan, mapping or implement session hands back to the person whenever its turn ends: having stopped is itself needing the person. The status says the session is waiting; what it is waiting for is read from the session itself.

## What a session is offered

A session's phase decides what its model can do: a capability outside the phase is not offered, so the model never proposes it and there is nothing to turn down.

## Parked

- ADO: `get_work_item` and creating tasks under the user story from the spec's task list. No work items exist yet.
- Repo map for phases 2 and 3 (project list, public type index, folder conventions).
- Anthropic Messages API adapter under API key in the own-loop engine.
- Compaction in the own-loop engine.
- Retrieval in phase 1 (large intent tree, work-item graph, WebSearch).

## Interrupting

Interrupting a session ends the turn it is in. Anything the session was waiting on is abandoned rather than answered, and the session learns how it ended when the person next prompts it.

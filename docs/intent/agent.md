# Agent definition

## Why

Blind planning exists because a planner that can read the code inherits the code's mistakes as constraints. Every workaround becomes an implicit requirement, and the feature gets shaped to fit the defect. Deriving the spec from intent alone makes disagreement between intent and implementation visible rather than silently absorbed. Phase 2 is not "soften the spec until it fits"; it is "name each disagreement and rule on it", with the code as the presumed-wrong party.

## Engines

A session runs on one engine, chosen per session or per phase:

- Claude through the Agent SDK (Claude Code as a library, JavaScript build, inherited Claude Code login).
- GLM-5.3-Flash and Kimi K3 through Berget AI (OpenAI-compatible) with our own loop and tools.

The extension only sees `CodeSession`: send a prompt, stream events, answer permission requests, interrupt. Engines differ below that line.

## Shape

Three phases, each a separate session with its own system prompt and tool set. Handoff is files on disk, never conversation context. Planning produces one document, the spec, approved once; reconcile is part of planning and writes its findings into that document.

```
docs/intent/**  +  work item  →  spec.md  →  spec.md + findings  →  approved spec  →  code
                    (blind)                  (reconcile)                            (implement)
```

## Phase 1: Blind plan

Sees: feature description, domain brief (ubiquitous language, stack, constraints), `docs/intent/**`, one work item closure when ADO is connected.
Never sees: source, descriptive docs, PRs, build output.

Until ADO is connected the feature description is typed by the user or picked from `docs/intent/**`. The agent plans the user story itself; the spec's task list is the source for the ADO tasks created under the story once ADO is connected (write-back, not read-only).

Tools: Read/Glob scoped to `docs/intent/**`, `get_work_item(id)`, AskUserQuestion, optionally WebSearch. Bash denied by bare name (allow-lists only auto-approve; a bare-name deny removes the tool from context).

First a direction in chat (the decisions that shape the feature, the questions that would change them); nothing is written until the user says go. Then `plan/<feature>.spec.md`: goal and behaviour always, edge cases, tasks and open questions when the feature has them, stable item IDs. An item derived from intent cites its section (`B2 (docs/intent/orders.md#Cancellation)`); an uncited item is the planner's default. To the point, not complete: an item earns its place by changing what gets built or how it is tested. No code paths. If `docs/intent/**` has nothing on the feature, ask and stop.

### get_work_item

Hand-coded, read-only, Azure DevOps. Server-side filtering is the enforcement.

- Include: title, description, parent chain, Goal/Actor/Impact/Behaviour/Example.
- Exclude: state, comments, tasks, linked PRs/commits/branches/builds, `System.*` and `Microsoft.VSTS.*` fields.
- Walks parents, children, related. Depth and total caps, cycle detection, deterministic ordering. Returns markdown. Snapshot to `plan/<feature>.context.md`.
- State is excluded deliberately: a Done item over drifted code is evidence for phase 2, not input to phase 1.
- Prose may leak file paths; accepted, or stripped in the tool.

### Docs split

`docs/intent/**` is phase 1 scope. Everything else is phase 2 only. Descriptive docs drift with the code in the same direction and arrive labelled as authority.

## Phase 2: Reconcile

Tools: Read, Glob, Grep, Skill; Edit and Write on the spec and its intent amendments only. Bash denied by bare name.
Input: spec + context + repo. Not the phase 1 transcript, and not `docs/**`: the spec is the intent for this feature, and the citations on its items are what the check opens when it needs intent's exact words.

A run, not a session: started from the plan bar, it runs under the plan session's tab with no tab or transcript of its own, only a one-line progress indicator in the plan bar and a stop. It ends when its turn ends; a re-check is a new run. Its full transcript is in the run log for inspection.

The job is to find what stands in the feature's way before implementation starts, not to grade the spec. Only findings are reported; a spec item the code accommodates without incident is not mentioned. An empty list is a valid result.

A finding is one of:

| finding | meaning |
|---|---|
| contradiction | a business rule in the code says otherwise; human decides which side is right |
| breakage | existing behaviour the feature would change or break, that the spec does not mention |
| naive | the spec assumes something the code shows to be wrong; amend the spec, reason required |

Output: a `Findings` table in the spec with the columns Finding and Proposed solution, each finding naming the spec item and the code it rests on, short enough to read in one sitting. The check fills the Finding column only. When the run ends with findings that have no proposal, the plan session is handed their ids and fills in Proposed solution for each: how the spec should change, or why it should stand, with the reason. The user rules on findings as on any other plan item, in the plan session, which revises the spec per ruling and marks the finding `[resolved]`; the spec is approved once. No separate plan document, no file list: phase 3 finds its files itself.

Authority order is fixed in the prompt: work item, then intent doc, then code. Amendments (`naive`) and contradictions ruled in the spec's favour are written back to `docs/intent/**` or the work item as an explicit output, so intent does not rot.

### Intent write-back

Phase 1 is blind: it reads `docs/**` and nothing else. A ruling that lives only in a spec is therefore invisible to the next feature's planner, which will re-derive the same question and may settle it the other way. So what a feature settles has to reach the docs it was planned from.

The agent never edits `docs/`: intent is the user's. It proposes, in `plan/<feature>.intent.md`, one section per amendment — an id, a mode, the doc and heading it lands in, where it came from and why, then the text as intent would read it.

```markdown
## A1 (append) docs/intent/orders.md#Cancellation
- from: F3 (naive)
- why: intent does not say what happens to the reservation.

Cancelling an order releases its reservation immediately.
```

The modes are `append` (add to the section), `replace` (rewrite its body) and `new` (add a section, or a document). The plan and reconcile scopes make that file writable; `docs/**` stays read-only to every phase.

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

Tools: Read, Write, Edit, Glob, Grep, Bash. Input is the approved spec only, fresh session started from the plan bar; refuses to start on `status: draft`. Breakage findings the user chose to fix are work items alongside the spec's tasks. Writes go through the ordinary permission prompt; no scope guard.

- Task state is the spec: the implementer appends `[done]` or `[blocked: reason]` to a task line, so item 4 of 7 survives a fresh session and shows in the plan view.
- Verification on stop through the `kiwiAgent.verify` rules, switchable per session, with the failure budget from settings.
- Done when the tests for the behaviours pass, not when the model stops.

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

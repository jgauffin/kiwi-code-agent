# Agent definition

## Why

Blind planning exists because a planner that can read the code inherits the code's mistakes as constraints. Every workaround becomes an implicit requirement, and the feature gets shaped to fit the defect. Deriving the spec from intent alone makes disagreement between intent and implementation visible rather than silently absorbed. Phase 2 is not "soften the spec until it fits"; it is "name each disagreement and rule on it", with the code as the presumed-wrong party.

## Engines

A session runs on one engine, chosen per session or per phase:

- Claude through the Agent SDK (Claude Code as a library, JavaScript build, inherited Claude Code login).
- GLM-5.3-Flash and Kimi K3 through Berget AI (OpenAI-compatible) with our own loop and tools.

The extension only sees `CodeSession`: send a prompt, stream events, answer permission requests, interrupt. Engines differ below that line.

## Shape

Three phases, each a separate session with its own system prompt and tool set. Handoff is files on disk, never conversation context.

```
docs/intent/**  +  work item  →  spec.md  →  plan.md  →  code
                    (blind)      (reconcile)   (implement)
```

## Phase 1: Blind plan

Sees: feature description, domain brief (ubiquitous language, stack, constraints), `docs/intent/**`, one work item closure.
Never sees: source, descriptive docs, PRs, build output.

Tools: Read/Glob scoped to `docs/intent/**`, `get_work_item(id)`, AskUserQuestion, optionally WebSearch. Bash denied by bare name (allow-lists only auto-approve; a bare-name deny removes the tool from context).

Output `plan/<feature>.spec.md`: behaviour, invariants, edge cases, acceptance criteria with stable item IDs. No file paths. If `docs/intent/**` has nothing on the feature, output questions and stop.

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

Tools: Read, Glob, Grep. Edit/Write/Bash denied by bare name.
Input: spec + context + repo. Not the phase 1 transcript.

Output `plan/<feature>.plan.md`, front-matter `status: draft|approved`, one verdict per spec item:

| verdict | meaning |
|---|---|
| matches | nothing to do |
| drifted | correct the code |
| naive | amend spec, reason required |
| conflict | sources disagree, human decides |

Authority order is fixed in the prompt: work item, then intent doc, then code. Amendments (`naive`) and drift findings are written back to `docs/intent/**` or the work item as an explicit output, so intent does not rot.

## Phase 3: Implement

Tools: Read, Write, Edit, Glob, Grep, Bash, task state. Input is the approved plan file only, fresh session; refuses to start on `status: draft`. Drift items are work items alongside feature items.

- Verification hook after edits: build scoped to the project owning the edited file, test selection, run on plan-item boundary; failure budget of N consecutive failed fixes per item, then stop and write the failure into the plan.
- Read-before-edit staleness: refuse to edit an unread file, re-read when changed underneath.
- Explicit task state so item 4 of 7 does not vanish.
- Done when the acceptance-criteria tests pass, not when the model stops.

## Instructions

Small shared core plus a per-phase file. Per-type rules inject via PreToolUse hook matched on the path at edit time.

- Checkable rules (no `#region`, no AutoMapper/MediatR, nullable on, no `Any`) go to analyzers, `.editorconfig`, BannedApiAnalyzers, grep in the verification hook.
- Judgment rules (rule of three, earned abstraction) go to the prompt.
- A phase file over a page means the excess is checkable or is spec. Remove alternatives instead of instructing tool preference.

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

- Repo map for phases 2 and 3 (project list, public type index, folder conventions).
- Anthropic Messages API adapter under API key in the own-loop engine.
- Compaction in the own-loop engine.

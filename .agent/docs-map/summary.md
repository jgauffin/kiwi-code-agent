### ReadMe.md
The product pitch for the Kiwipow Agent VS Code extension: what it does differently, what it needs to run, and where the rest of the docs are.
- `#Why it's different`: the five selling points as a table — planning from intent rather than code, approved rules holding across sessions, tests as evidence of done, one script per turn staged as one diff, and read-before-write safety with parallel agents
- `#Any model, per step`: the two engines (Claude Agent SDK, any OpenAI-compatible endpoint), profiles picking a model per step, and that `.mcp.json`, instruction files, skills and permissions behave the same on both
- `#Also`: the smaller capabilities — cleanup after green, docs evaluation, chat and plan sessions, which tools run unprompted, and querying large JSON
- `#Get started`: installing from the Marketplace (Windows x64/arm64), the Anthropic API key or Claude Code login a Claude session needs, and the first Feature planning session
- `#More`: which doc covers plan sessions, settings, building from source and the design rationale

### docs/developing.md
How to build, run and package the extension from source, including the npm commands and the F5 development host.
- `#Use the working copy as the installed extension`: `npm run link-dev` to point the installed extension at the repo, what a reload keeps, and `npm run unlink-dev` to undo it
- `#Package`: the `npm run package` command and the `.vsix` it produces

### docs/features/README.md
The index of unbuilt features, listing the six feature files in rough build order and stating that each is a candidate input for a Plan session while `docs/intent/agent.md` carries the why.

### docs/features/ado-integration.md
The planned Azure DevOps integration: work items as planning input and spec tasks written back as ADO tasks.
- `#Reading`: the organization/project/PAT settings, the `get_work_item(id)` tool and the fields it includes and excludes, the closure walk with its caps, and the `plan/<feature>.context.md` snapshot the plan session reads instead
- `#Writing`: creating one ADO task per spec task item under the user story, writing task ids back into the spec to avoid duplicates, `drift`-tagged items, task-state updates from implement sessions, and what is out of scope

### docs/features/composer-input.md
The planned workspace-aware prompt box: the already-built "Link open file" chips, plus `@` file picking, "Add selection", `/` for skills and commands, pasted images, per-session drafts and up-arrow recall, and the mentions and templates left out.

### docs/features/coordination.md
How several sessions in one workspace avoid writing over each other and pass notes, as a feature yet to be built.
- `#Claims`: the `.agent/sessions/<id>.json` registry, the PreToolUse hook that claims a file on first Edit or Write and denies it to others, release on task completion, stale claims past `deadline` flagged as `needs_human`, and what force-release does to the held session
- `#Checkpoints`: the opt-in `checkpoint(reason)` and `revert` tools, what is copied under `.agent/runs/<id>/checkpoints/`, the hash check that refuses files changed underneath, and repeated checkpoints marking an item for review
- `#Channels`: non-blocking `send(session, text)`, the "1 message waiting" tail and `read_messages()`, delivery as a user turn to an idle session, thread caps, and what coordination does not cover

### docs/features/own-loop-compaction.md
How a conversation that outgrows the model's context window is folded down without losing the work, on the own loop and on the Claude engine.
- `#When it happens`: the window per model, the 90% and compaction-limit thresholds, the too-long-context retry, and the one turn that is left to fail rather than summarised
- `#What survives`: the tail of whole turns kept verbatim, the fixed summariser prompt over the rest, and the shape of the compacted conversation
- `#The ledger`: the record of files read, edited and written that replaces the folded file contents, why it lives outside the summary, and its 60-file cap
- `#Reading again before writing`: why compaction clears the read tracker for folded reads, and what that protects `Write` from
- `#What the session reports`: the `compacting`, `compacted` and `context_usage` events, the chat marker, and the untouched run log
- `#Manual compaction`: the meter under the chat box and what its button does between turns and mid-turn
- `#Claude engine`: auto-compaction disabled, the engine's own window, the 75% interrupt-and-`/compact` turn, failure handling, and `compact_boundary` mapping
- `#Not included`: cross-session memory, context editing, and the ledger not surviving a resume

### docs/features/retrieval-subsession.md
The planned `retrieve(question, known, budget)` tool for reconcile and implement sessions: a depth-1 sub-session on the `kiwiAgent.retrievalProfile` with the caller's non-writing tools that quotes verbatim excerpts with provenance into `.agent/runs/<id>/retrieval/<n>.md`, under a per-call budget, shown as one collapsible transcript row, and what it excludes.

### docs/features/session-cost.md
The planned per-session token and cost totals: where they are shown (tab tooltip, Sessions view, composer), that they are summed from `turn_done` events in the run log, the `kiwiAgent.pricing` setting for models the Claude engine does not price and the "n/a" fallback, and that budgets and cross-session reporting are out of scope.

### docs/intent/agent.md
The agent's own definition: why feature planning is blind to the code, and how the phases, their tool scopes, files and stages work.
- `#Why`: the reason the planner never reads the code — a code-reading planner turns workarounds into requirements — and that phase 2 names disagreements rather than softening the spec
- `#Engines`: the two engines a session can run on, the `CodeSession` line the extension sees, switching engine mid-session, and MCP servers from `~/.mcp.json` and `.mcp.json` behaving alike on both
- `#Shape`: the three phases as files on disk, the blindness boundary, the pipeline from docs and specs to passing tests, what an approved spec is, and names rather than synthetic ids as the anchors
- `#Stages`: the eight stages derived from a feature's files, which files are committed and which are working files that get cleaned up, and the plan bar and tab strip the plan view shows per stage
- `#Phase 1: Feature planning`: what the planner sees and never sees, its tool set and the Bash deny, chat-first direction before any write, and the citation rule for rules drawn from a doc or spec
- `#The spec contract`: the required `Goal` and `Open questions` sections, scenarios as `##`, rules and one level of nested edge cases, bold names that never change, no invariants or acceptance sections, and parse-time repair
- `#get_work_item`: the read-only Azure DevOps tool — which fields are included and excluded, why state is excluded, traversal caps, and the snapshot it writes
- `#Docs split`: that all of `docs/**` and every spec is phase 1 scope while code and code-derived context are not, and how doc sections an approved spec now covers are listed or cut under `kiwiAgent.cutCoveredDocs`
- `#Finding the way in`: the docs map as the planner's entry point and citation source, reading by section (the 200-line outline rule, MarkdownSearch results, the exemptions), and the docs evaluation as the job of arranging docs
- `#Phase 2: Check against code`: the check's tools and inputs, its being a run without a tab, what counts as a finding, the decisions file format, how proposals, recommendations and rulings are added and applied, and the task board derived once no decision is pending
- `#The check has no voice`: that the check never asks and shows only a progress line, writing what it cannot settle as a finding
- `#Retrieval`: the `retrieve(question, known, budget)` sub-session — quoting without interpreting, derived tool set, no interaction or recursion, result shape, where it is written, budgets and fan-out
- `#Phase 3: Implement`: the implementer's tools and inputs, one run per task with its kickoff, fix runs, how `keep` rulings and user answers reach it, and task state, coverage proofs and what counts as finished
- `#Unfiled decisions`: how a decision made outside planning is recorded in the spec or in `plan/unfiled-decisions.md`, its authority, and the File decisions session that moves entries into specs and docs
- `#Migration`: what `Migrate plans` and Repair convert by rule (boards, legacy sections, id-shaped lines) and what is handed to the plan session, plus rename follow-through and kept approval
- `#Verification`: the model-free `kiwiAgent.verify` rules over the files tasks name, how outcomes are recorded, the failure hand-off and `kiwiAgent.verifyFailureBudget`
- `#Instructions`: the shared core plus per-phase files, path-matched per-type rules, where the user's and workspace's instruction files join, and which rules go to analyzers instead of the prompt
- `#Skills`: the skill folders under user profile and workspace, precedence on a shared name, how the index rides in the `Skill` tool, and which phases carry it
- `#Coordination`: the claim registry and read/write denial between live sessions, stale claims and force-release, opt-in checkpoints and revert, and non-blocking session channels
- `#Observability`: what is recorded under `.agent/runs/<id>/` and where generated context (repo map, docs map) sits
- `#Per-phase model`: that the step-to-model mapping lives only in the active profile, never per feature, and chat and feature phases are independent
- `#Waiting for the person`: that a turn ending is itself the hand-off, and the status is read from the session
- `#What a session is offered`: that a phase's tool set decides what the model can propose
- `#Approved rules bind every session`: that every code-changing session checks the approved specs covering its change and asks before breaking a rule
- `#Parked`: deferred work — ADO write-back, the repo map for phases 2 and 3, the Anthropic Messages adapter, own-loop compaction, phase 1 retrieval
- `#Interrupting`: that an interrupt ends the turn, abandons what was waited on, and the session learns of it on the next prompt

### docs/plan-sessions.md
The session types on the new-session screen and the feature-planning workflow step by step, from first prompt to verified build.
- `#Feature planning`: what the blind planning session may read and write, the spec contract it writes to, how rule names are used as anchors, and which writes are prompted
- `#Finding the way around the docs`: the docs map as the session's entry point and citation source, how it is built and rebuilt, and what the Evaluate docs session does and when it opens up to the full tool set
- `#The view`: the Plan/Chat bar and the Plan view stage by stage — Draft comments, Approve and the code check, ruling decisions, the derived task board and doc listing, implementation runs and the verify sweep — plus where the files live, when working files are deleted, and the Migrate plans command
- `#From a chat`: how a chat answers where a feature stands and writes draft specs from the docs when a project has no specs yet
- `#Unfiled decisions`: how decisions made outside planning reach the next planner, the `plan/unfiled-decisions.md` format, and the File decisions session on the Maintenance tab

### docs/settings.md
Every Kiwipow Agent setting: the settings page's tabs, each `kiwiAgent.*` key with its shape and effect, plus where instruction files, MCP servers and logs live.
- `#Instruction files and skills`: which `CLAUDE.md`/`AGENTS.md` paths and `SKILL.md` folders load at user and workspace level, in what order, and which the Claude engine reads itself
- `#MCP servers`: how `.mcp.json` and `~/.mcp.json` give both engines their tools, the `mcp__<server>__<tool>` naming and permission prompts, overriding a user server per workspace, and the one-time copy of Claude Code's `~/.claude.json` servers
- `#Logs`: where session events, system prompts, the repo map, the docs map and a feature's working plan files are written under `.agent/`, and what to gitignore

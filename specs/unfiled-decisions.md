# Unfiled decisions

### Optional rules leave the phase instructions and live in rule bundles
- decided: A phase's instructions hold only what makes the agent work the way it does — blind planning, the spec contract, reading before writing, tests as evidence; rules of practice such as reproducing a bug before fixing it, refactoring towards SOLID or naming conventions are gone from them and reach a session only as a rule bundle the person applied, which no workspace gets pre-applied on upgrade and which the blind planner never carries.
- affects: bundles, instructions and skills, docs/intent/agent.md

### AGENTS.md is the instruction file the product standardises on
- decided: Rules are kept in `AGENTS.md` at the workspace and the person's level, and a workspace or person still on `CLAUDE.md` is offered once to move everything it holds there and drop `CLAUDE.md`, after which both engines work from the one file and the person's memories are written to and read from `AGENTS.md`.
- affects: bundles, moving to this agent, project and user wide memories, instructions and skills, docs/settings.md, docs/intent/agent.md

### Rule bundles come from git repositories, the product's own and the company's
- decided: Bundles are fetched from git repositories with the person's existing git credentials — the product's own catalog always, further ones named as repository URLs in the person's and the workspace's settings — each new source accepted by the person before its first fetch, and a source repository may name bundles its workspaces must carry.
- affects: bundles, docs/settings.md

### A bundle may declare metadata the agent reads
- decided: Beside its rule text and skills, a bundle declares metadata about what it is and what it claims: the stack or framework it applies to, and for a test bundle the test surfaces and the test type it owns. The agent reads that metadata to match a bundle to a workspace and to compose the applied bundles into one coherent whole, rejecting two bundles that claim the same ground. The metadata adds no rule text of its own and nothing in it runs.
- affects: bundles, choosing a test strategy

### Memories are kept in Claude Code's memory files
- decided: The agent's project-wide and user-wide memories are kept in Claude Code's memory layout rather than a store of our own, so a session on the Claude Agent SDK reads them natively while a session on an OpenAI-compatible endpoint reaches the same notes through the agent's memory tools; memories stay with the person's own files and are never kept in the workspace's source.
- affects: project and user wide memories, instructions and skills, docs/settings.md, docs/intent/agent.md

### A feature-planning session is given no memories
- decided: Memories reach every session that may read the code but never the blind planner, since a memory is learned while working in the code and a lesson about how to plan belongs in the planning instructions instead.
- affects: project and user wide memories, docs/intent/agent.md

### Staged script changes are judged by the permission rules
- decided: The changes a script stages are an ordinary write: the "Allow writes" switch, an allow rule covering every staged file, or a deny rule answers for them, and the combined diff is put to the user only when the rules leave the decision open.
- affects: running a script, permissions and the Allow writes switch, file edit diff

### The Allow writes switch is the only standing answer a write prompt leads to
- decided: A write prompt for a file in the project is answered Allow or Deny for that call alone; it no longer offers the file or its folder as a rule to remember, since the "Allow writes" switch is how the person stops being asked. Turning the switch on while a prompt waits answers every prompt it covers, so the switch replaces the click rather than being asked for twice.
- affects: permissions and the Allow writes switch, running a script

### Reading before editing is enforced, not instructed
- decided: The extension refuses a write to a file the session never read or that changed since the session last saw it, naming what changed it, and the phase instructions no longer tell the model to read before editing.
- affects: parallell session support, own-loop compaction, instructions and skills, docs/intent/agent.md

### A failure in code the feature never touched is not the feature's failure
- decided: Verification separates its failures by whose change they stand on: a failing test in a file only another hand changed is foreign, it is retried after a wait rather than handed to the implementer, it spends none of the verify failure budget, and a feature left with foreign failures waits for the user instead of reaching verified.
- affects: parallell session support, cleanup phase, docs/intent/agent.md, docs/settings.md

### The user's MCP servers live in `~/.mcp.json`, and Claude Code's list is moved there once
- decided: MCP servers are read from `~/.mcp.json` for every workspace with the workspace's own `.mcp.json` over it by name, one format at both levels. Claude Code keeps the user's servers inside its own settings file instead, so on first run they are copied out into `~/.mcp.json` verbatim; the copy is skipped whenever that file already exists, so a server the user later removes stays removed and no migration flag is kept anywhere. Servers Claude Code holds per project are left alone.
- affects: MCP servers, docs/settings.md, docs/intent/agent.md

### The new-session screen splits work in the code from maintenance
- decided: The new-session screen is in two tabs. Code holds the session types that work in the code (Chat, Plan, Feature planning) and the work waiting to be picked up; Maintenance holds the jobs that keep the intent in order, one per input — cleaning up the docs and filing the recorded decisions — counting on the tab what waits to be filed. A maintenance job is not a session type among the others, and what waits to be filed is offered there rather than in the pick-up list.
- affects: starting a new session, sessions and tabs, doc migration, filing unfiled decisions, picking up a plan

### Every session has its own tab, in the right sidebar
- decided: The chat lives in tabs, one per session, opened in the right sidebar rather than where the person's code opens, so the agent never takes the place a file would. A tab is there to be named and to carry an icon: captioned by its session (a chat by its first message, a plan by its feature name) so the person can tell the sessions apart, and wearing the icon that says this session wants attention. Only one tab is read at a time and a session at work is hidden by whichever tab is up, which costs nothing, since what a hidden session needs is said by its icon. The agent icon and "+" always open a new tab on the new-session screen, where work waiting to be picked up (plans on disk, chats not shown, decisions not yet filed) is offered; a session started there takes that tab. Clicking a session in the Sessions list brings up its tab, or opens one. The docs cleanup and the decision filing are listed with the chats, so a closed tab can be reopened. Every run of one feature (planning, checking, implementing, cleanup) shares the feature's one tab.
- affects: sessions and tabs, starting a new session, picking up a plan, filing unfiled decisions, doc migration

### Bringing the docs in line with the specs is a maintenance job of its own
- decided: The one maintenance job that works from the docs, beside filing the decisions, goes over the docs against the settled specs, offers to remove the behaviour a spec already defines, then offers to turn the feature descriptions no spec holds into specs, and last tidies how what stays is arranged for a blind planner; it keeps the planner's read scope for its whole life, confirms every doc write, and writing specs from the docs is this job rather than something a chat is asked for.
- affects: doc migration, starting a new session, docs/plan-sessions.md, docs/intent/agent.md

### A settled feature is developed further by changing its spec
- decided: Carrying on with a feature whose spec is settled is a change to that one spec rather than a new feature beside it: it is offered on the feature itself once its build has nothing in flight, revises the spec in place keeping every rule's name and marking a dropped rule removed, and takes in any unfiled decision naming that feature, removing the entry once its words stand as rules.
- affects: change feature, filing unfiled decisions, picking up a plan, starting a new session, docs/intent/agent.md, docs/plan-sessions.md

### Only a settled spec outranks a doc
- decided: A doc section is treated as said twice, and offered for removal, only against a spec the person has approved, whatever stage its build has reached; a draft spec is a proposal and never costs a doc anything.
- affects: doc migration, docs/intent/agent.md

### The plan view hands over to the next step's tab unless the reader went elsewhere
- decided: A feature's Cleanup tab is there from the moment its tests pass, before anything is measured, saying that nothing has been measured yet; when the step moves on, the tab the reader is on moves with it only while it is the tab the step they were watching worked in, so a reader who opened the spec or the review themselves is left reading it and the plan bar alone says where the feature now stands. A feature whose working files are swept has no board left and keeps no Cleanup tab.
- affects: cleanup phase, finishing the build, sessions and tabs

### A draft spec records how it was authored, and is pickable work
- decided: Every draft spec carries how it came to be — planned with the person, drafted from the docs, or hand-written when nothing records it — and is offered on the new-session screen's Code tab as work waiting to be picked up, showing that beside how far its review got, since how complete a draft is depends on who wrote it and a pickup's critique goes as deep as that warrants.
- affects: spec drafts, doc migration, picking up a plan, starting a new session, docs/plan-sessions.md

### A tab stopped mid-turn on the person pulses its icon
- decided: A tab fades its icon in and out, slowly and for as long as it lasts, only while a run of its session is stopped mid-turn on the person: a question is open, or a permission prompt is pending. A turn that merely ended is not that, even where the next move is the person's: every plan and build turn ends so, and it stands until the next prompt, so a tab wearing it would pulse for good. What a finished turn leaves to do is the plan bar's to say.
- affects: sessions and tabs, user question, finishing the build

### A question or a permission prompt may be answered from outside the editor
- decided: Anything that blocks a session from completing — a question asked, a permission prompt pending, a step waiting on the person — can be put to a paired phone and answered there with the same effect as at the desk, the first answer from any device resolving it while every other device is told it was already answered, so a session never stalls for want of someone at the keyboard.
- affects: remote control, user question, file edit diff, permissions and the Allow writes switch, docs/settings.md

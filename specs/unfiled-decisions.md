# Unfiled decisions

### Ctrl+click on a spec to pick up opens it in a tab of its own
- decided: On the new-session screen, Ctrl+click (Cmd+click on a Mac) or a middle click on a spec in the pick-up list opens that feature's planning session in a new tab while the screen stays the tab in view, with whatever was typed on it, so several specs can be opened in a row; a plain click still opens it in place of the screen.
- affects: spec folders, spec drafts

### A built feature's spec edited back to draft is planned in its own tab
- decided: Picking a draft that was revised after its feature was built brings the feature's existing planning tab back, and the planner names the rules the task board has nothing built for (new, or reworded since), says whether each makes sense and how it would be built, and writes nothing until the user says go; a revision that session already saw is not raised again.
- affects: Spec drafts, Changing an implemented spec

### The research sub agent searches through Brave Search by default
- decided: The research sub agent's searching runs against the Brave Search API by default; its key is configured the same way a model provider's key is, under Advanced settings, stored in the editor's secret storage rather than settings.json. Fetching one address needs no key at all.
- affects: sub agent support, docs/settings.md

### A subagent's output is named with the agent it came from
- decided: Every message and every step produced inside a subagent carries the agent it came from, taken from the call that spawned it, and that call names its agent too, so output from several agents running at once is never read as the main thread's. A message whose spawning step is not on screen still says it came from a subagent. Subagents run on the Claude engine only.
- affects: sessions and tabs, parallel session support

### The activity row follows the main thread, not the subagents under it
- decided: The row saying what a session is doing names what the main thread waits on, which while agents run is the step that spawned them, and what an agent is doing inside that step never renames it; the time spent is the step's, not restarted at each change of name. A permission prompt raised inside a subagent is shown in that agent's step rather than at the foot of the conversation.
- affects: sessions and tabs, parallel session support

### A spec's state shows on its file in the explorer
- decided: Every spec file carries its status in the file explorer as a symbol badge (draft, approved, implemented, verified) with the full word on hover, kept current as the file changes, so where a feature stands is visible without opening the spec or the Sessions view. The badge never uses a letter and never colours the file name, both of which belong to git's own marks in that place.
- affects: spec drafts, sessions and tabs

### A spec is opened in its planner from the file itself
- decided: A spec file offers the planner for its feature from the file explorer, whatever its status, and the editor offers it as a button while the spec is still a draft, so planning carries on from the spec rather than only from the Sessions view. The status badge is not the way in: it cannot be clicked.
- affects: spec drafts, picking up a plan, sessions and tabs

### Work on a draft shows on the plan bar, not in the chat alone
- decided: While a planner turn is in flight on a draft whose Approve stands open — the critique a pickup writes among them — the plan bar carries a line beside Approve saying the planner is at work and answers in the chat, so the person is not left with a still bar and a button they could press mid-thought. Approve stays theirs to press throughout; the line never takes it away. It is greyed while the turn runs, so the line is what the eye lands on rather than the button.
- affects: spec drafts, picking up a plan, sessions and tabs

### A picked-up draft is read in its chat, not on its spec
- decided: Picking a draft up opens that session on its chat rather than on its spec, and the critique landing leaves the reader there instead of handing the tab over to the spec the way every other planner turn does, because whether the draft has gone stale is said in the chat and nowhere else. Any later turn of that session hands over to the spec as usual.
- affects: spec drafts, picking up a plan, sessions and tabs

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

### Reading before editing is enforced, not instructed
- decided: The extension refuses a write to a file the session never read or that changed since the session last saw it, naming what changed it, and the phase instructions no longer tell the model to read before editing. A change a script derives from its own read of that same file is the exception: that read counts as the session having seen the file, and in return the agent is given the diff of what the script changed, whole while it fits the output budget and otherwise cut per file with what was left out named, so verification lands after the change on the lines that changed rather than before it on whole files.
- affects: parallell session support, own-loop compaction, running a script, file edit diff, instructions and skills, docs/intent/agent.md

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

### Remote control's forwarding service has a fixed address and ships behind a flag
- decided: The forwarding service remote control pairs through lives at a known address (remote.kiwipow.com) rather than one each workspace points at on its own, and the pairing and connecting built against it stays off by default until the service itself is in place, turned on per workspace once it is.
- affects: remote control, docs/settings.md

### Changing a spec begins on the new-session screen with a described change
- decided: The new-session screen's Code tab carries *Update spec*, where the person picks any spec, whatever state it is in, and describes in their own words what should change; the pick routes by state, a settled spec into a change of that spec and a draft into a draft pickup, nothing starts until the change is described, and a spec opened from that screen always shows the act that changes it.
- affects: changing an implemented spec, change feature, spec drafts, starting a new session, picking up a plan, docs/plan-sessions.md

### A change is never answered by the phase conversation the tab is showing
- decided: Asking for a change on a feature opens the describe-the-change step and plans it in a feature-planning session, never handing the request to the cleanup, implement or check conversation its tab happens to show; a feature whose only open step is an unsettled cleanup is changeable, and that cleanup waits for the change's own build.
- affects: changing an implemented spec, change feature, cleanup phase, sessions and tabs, docs/intent/agent.md

### No two features share a name
- decided: A feature's name identifies it, so starting feature planning on a name another feature already answers to is refused rather than started: the refusal names the feature holding it and offers the two ways on, picking that plan up or describing a change to its spec. Names are compared by the spec they resolve to rather than by spelling, so two spellings that would land on one spec collide, and a feature whose planning has yet to write a spec holds its name from the moment it starts.
- affects: starting a new session, picking up a plan, changing an implemented spec, spec drafts, sessions and tabs

### Specs may sit in domain folders, and the agent picks the folder
- decided: A spec may live in a folder named after the domain it belongs to rather than only at the root of the specs folder; the planning session proposes that folder with its direction, read from the feature's description and the folders the workspace already has, and the person keeps or changes it before anything is written. The folder is grouping only: a feature is still identified by its name alone, every spec is read, searched and cited wherever it sits with its folder in the citation, and the working files stay keyed by the feature's name. Whether folders are used follows the workspace by default, and the docs cleanup job offers once to sort the specs that already exist into folders, citations following each move.
- affects: spec folders, doc migration, changing an implemented spec, spec drafts, docs/intent/agent.md, docs/plan-sessions.md, docs/settings.md

### The blind planner reaches the internet through a research sub agent
- decided: A feature-planning session may research on the internet, but only by handing one question to a research sub agent whose tools are its own blind set plus searching and fetching, so the planner stays blind to the code while its question is answered; the person approves the research rather than each site visited, and a workspace may allow it outright. What research turns up is never a citation on a rule: a rule it informed is the planner's own default. This takes phase 1 research off the parked list.
- affects: sub agent support, feature planning, docs/intent/agent.md

### A sub agent is a delegate a code-reading session can call on the engine we own
- decided: Work a session wants done without filling its own context is handed to a sub agent: one the product ships, one defined in the person's or the workspace's files alongside skills, or one the calling session defines in the call itself together with what it wants back. A sub agent's tools are capped by what its caller is offered, it cannot delegate further, it spends a budget the caller sets, and it reports once. That is the delegation of a session on an OpenAI-compatible endpoint; a session on the Claude engine keeps that engine's own way of handing work on, which the product does not list, cap or replace. The quote-only lookup is one of the sub agents the product ships.
- affects: sub agent support, retrieval sub-session, instructions and skills, choosing models, session cost, docs/intent/agent.md, docs/settings.md

### A feature can be named by the model from its description
- decided: Naming a feature is offered rather than left to the person: from the description they have written, the model proposes a name clear of the ones already taken, and it lands in the name field as theirs to keep or edit, never as a name applied behind their back. Pressing it with nothing described asks for a description instead of guessing. The ask is one prompt on the model the feature's planning would run on, holding no conversation and keeping nothing.
- affects: starting a new session, choosing models

### Whether approval starts the build is chosen at approval
- decided: Approving a spec carries a switch for what follows, standing beside the act itself and remembered for the workspace: the check against the code, the docs listing and the board happen either way, and the build then either begins by itself as it does today or the feature stops there, planned and mapped, waiting for the person to start it. That is how several features are planned ahead while one is built at a time: each is taken to build-ready and sits until its turn.
- affects: feature planning, finishing the build, sessions and tabs, docs/intent/agent.md, docs/plan-sessions.md

### The mapping is diffed against the code when the build is started
- decided: The check that maps a feature to the code keeps a snapshot of the files its tasks name, and starting the build compares them against the code as it then stands; what changed in the meantime reaches the implementer as the changed line ranges of those files, so a mapping made before another feature landed is corrected rather than trusted. Nothing is re-checked and no decision is reopened: the implementer is told, and reads those places again itself.
- affects: feature planning, parallell session support, docs/intent/agent.md

### The person's own permission rules live in a file of their own under their home directory
- decided: An answer kept for the person rather than the workspace is held in a small file of its own under the person's home directory, the way `~/.mcp.json` already mirrors a workspace's `.mcp.json` for the person; a write to that file is always put to the person, the way a write to the workspace's own settings already is.
- affects: permission decisions, docs/settings.md

### A chat checks the specs against what it built, by instruction alone
- decided: A chat session that finishes coding something goes over the specs for rules its change touched and says which should be updated, as a rule in its instructions rather than a step the tab offers; what it finds is taken further through the ordinary described change to that spec.
- affects: bundles, instructions and skills, changing an implemented spec, docs/intent/agent.md

### A session may run on the Claude Code installed on the machine
- decided: Beside the Claude Code bundled with the extension, a provider may run the one installed on the person's own machine, so a model newer than the bundled engine knows is reached by updating that install rather than waiting for a release of this extension. The two are one engine in every other respect: the same session plumbing, tools, instructions, skills, memories, permissions and Claude login, and a session switching between them keeps what any cross-engine switch keeps. The installed engine is offered only once a Claude Code is found — the path the person named, else one on PATH, else where the native installer puts it — and a named path that holds nothing leaves the engine unavailable rather than falling back to another install. A provider lists the models its own engine serves, so Opus 5.5 and Sonnet 5.5 are reachable on the installed engine while the bundled engine keeps Opus 5 and Sonnet 5.
- affects: choosing models, bundles, moving to this agent, project and user wide memories, docs/settings.md, docs/intent/agent.md

### Newer models are offered rather than shipped as the default
- decided: What a fresh install runs is a model the bundled engine can run, so the product works before the person has a Claude Code of their own; reaching a newer model is an offer instead. Where the installed Claude Code can run a newer model than a profile names, the move is put to the person once as a notification and, until they take it or turn it down, on the models settings page, which says which models would move and which provider they would move to. Taking it adds the provider on that install and repoints only the profiles that named a superseded model, leaving the models they ran configured so the move can be undone; turning it down is remembered for the person, since the models are their own settings rather than a workspace’s. A model a profile is pointed at is never swapped for another without being asked.
- affects: choosing models, docs/settings.md

### Every read or write outside the project is asked about as a folder and a kind
- decided: A read or a write outside the project, by any shell command or file tool and not only by a change of directory, is asked about as the folder it reaches and whether it reads or writes there, with the person choosing how far up the grant reaches (a write may also be kept for its file), and the kept read or write grant then answers for every command and file tool doing that kind of thing beneath it; how that prompt and its grants behave is Directory permission's, while what counts as a read, a write or running a program stays Permission decisions'.
- affects: directory permission, permission decisions

### References run from specs to docs, never back
- decided: A spec cites the docs, but the code, its comments and the docs never cite a spec, a rule's name or a spec's path, and every session that writes code or docs is told so; a behaviour's reason is stated there in the domain's own words instead.
- affects: feature planning, doc migration, implementing a feature, chat, code planning

### The docs cleanup job is where a root-only workspace adopts folders
- decided: When spec folders follow the workspace and every spec sits at the root, the docs cleanup job still offers to sort the specs into folders and writes a draft into a folder once the person takes that offer or asks for folders, while drafts otherwise land at the root and only a setting of flat keeps the job from folders altogether.
- affects: spec folders, doc migration

### Running a script from the scratch folder stays asked
- decided: Writing and deleting in a session's scratch folder run unasked, but running a program the session wrote there is still asked like any other command, and sessions are told to compute in the sandboxed script tool instead and to write a script only for what that tool cannot do (spawning a process, loading a package, reaching the network).
- affects: permission rules, chat

### MCP servers start on the first call to one of their tools
- decided: A session offers each MCP server's tools as the server last listed them in this workspace and starts the server only when one of those tools is called (a server never run here, or whose configuration changed, is started once to learn its tools), and the person can start or stop each server from the composer, a stopped one starting again on its next call.
- affects: chat, docs/settings.md, docs/intent/agent.md


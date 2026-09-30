# Unfiled decisions

### Staged script changes are judged by the permission rules
- decided: The changes a script stages are an ordinary write: the "Allow writes" switch, an allow rule covering every staged file, or a deny rule answers for them, and the combined diff is put to the user only when the rules leave the decision open.
- affects: running a script, permissions and the Allow writes switch, file edit diff

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
- decided: The new-session screen is in two tabs. Code holds the session types that work in the code (Chat, Plan, Feature planning) and the work waiting to be picked up; Maintenance holds the jobs that keep the intent in order — evaluating the docs, filing the unfiled decisions — counting on the tab what waits to be filed. A maintenance job is not a session type among the others, and what waits to be filed is offered there rather than in the pick-up list.
- affects: starting a new session, sessions and tabs, docs evaluation, filing unfiled decisions, picking up a plan

### A session with a narrow scope opens up once it has said its findings
- decided: The docs evaluation goes on in its own conversation with the full tool set once its findings are said, rather than offering to be continued in a new chat: the narrow scope is there to keep the code out of the findings, and there are none left to draw. The user answers in the session they read the findings in. Continuing in a new chat is left to the plan against the code, which opens on the build it agreed to.
- affects: docs evaluation continued in chat, sessions and tabs, plan against the code

### Every session has its own editor tab
- decided: The chat lives in editor tabs, one per session, captioned by its name (a chat by its first message, a plan by its feature name), so a session at work is never hidden by starting another. The agent icon and "+" always open a new tab on the new-session screen, where work waiting to be picked up (plans on disk, chats not shown, decisions not yet filed) is offered; a session started there takes that tab. Clicking a session in the Sessions list brings up its tab, or opens one. The docs evaluation and the decision filing are listed with the chats, so a closed tab can be reopened. Every run of one feature (planning, checking, implementing, cleanup) shares the feature's one tab.
- affects: sessions and tabs, starting a new session, picking up a plan, filing unfiled decisions, docs evaluation continued in chat

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

### The chat is one view in the secondary sidebar, showing one session at a time
- decided: The chat lives in a single view in the secondary sidebar, never in the editor area; it shows one session at a time, headed by its name (a chat by its first message, a plan by its feature name). Clicking a session in the Sessions list switches the view to it; "+" puts it on the new-session screen, where work waiting to be picked up (plans on disk, chats not shown, decisions not yet filed) is offered. Every run of one feature (planning, checking, implementing, cleanup) shares the feature's one tab in the view.
- affects: sessions and tabs, starting a new session, picking up a plan, filing unfiled decisions, docs evaluation continued in chat

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

### A session is an editor tab of its own, named after itself
- decided: Every chat and every plan opens as its own editor tab named by the session — a chat by its first message, a plan by its feature name — instead of a strip of sub-tabs inside one shared panel; the sidebar holds only the Sessions list, whose "+" opens a blank tab, and work waiting to be picked up (plans on disk, chats with no tab open, decisions not yet filed) is offered on that blank tab's new-session screen. Every run of one feature — planning, checking, implementing, cleanup — still shares the feature's single tab.
- affects: sessions and tabs, starting a new session, picking up a plan, filing unfiled decisions, docs evaluation continued in chat

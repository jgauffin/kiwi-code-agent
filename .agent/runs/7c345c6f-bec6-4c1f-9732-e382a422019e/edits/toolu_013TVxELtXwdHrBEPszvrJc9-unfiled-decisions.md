# Unfiled decisions

### Staged script changes are judged by the permission rules
- decided: The changes a script stages are an ordinary write: the "Allow writes" switch, an allow rule covering every staged file, or a deny rule answers for them, and the combined diff is put to the user only when the rules leave the decision open.
- affects: running a script, permissions and the Allow writes switch, file edit diff

### A session is an editor tab of its own, named after itself
- decided: Every chat and every plan opens as its own editor tab named by the session — a chat by its first message, a plan by its feature name — instead of a strip of sub-tabs inside one shared panel; the sidebar holds only the Sessions list, whose "+" opens a blank tab, and work waiting to be picked up (plans on disk, chats with no tab open, decisions not yet filed) is offered on that blank tab's new-session screen. Every run of one feature — planning, checking, implementing, cleanup — still shares the feature's single tab.
- affects: sessions and tabs, starting a new session, picking up a plan, filing unfiled decisions, docs evaluation continued in chat

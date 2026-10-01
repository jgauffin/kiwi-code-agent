---
doc: docs/features/coordination.md
---
How several sessions in one workspace avoid writing over each other and pass notes, as a feature yet to be built.

- `#Claims`: the `.agent/sessions/<id>.json` registry, the PreToolUse hook that claims a file on first Edit or Write and denies it to others, release on task completion, stale claims past `deadline` flagged as `needs_human`, and what force-release does to the held session
- `#Checkpoints`: the opt-in `checkpoint(reason)` and `revert` tools, what is copied under `.agent/runs/<id>/checkpoints/`, the hash check that refuses files changed underneath, and repeated checkpoints marking an item for review
- `#Channels`: non-blocking `send(session, text)`, the "1 message waiting" tail and `read_messages()`, delivery as a user turn to an idle session, thread caps, and what coordination does not cover

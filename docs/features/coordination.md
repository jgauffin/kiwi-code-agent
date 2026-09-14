# Coordination

Several sessions work in one workspace without writing over each other, and can hand each other notes.

## Claims

- Registry `.agent/sessions/<session id>.json`: session id, mode, `plan_item_id`, claimed files, `deadline` (set by the session from the item's scope), last heartbeat.
- A PreToolUse hook on Edit and Write claims the file on first touch. If another live session holds it, the edit is denied and the message names that session and its plan item.
- A session reports an item done through the task-state tool, which releases its claims.
- Silence past `deadline` flags the claim as stale in the Sessions view and on the tab (status `needs_human`). Nothing is released automatically.
- Force-release from the Sessions view posts a revocation message into the stale session: it stops immediately, does not finish the in-flight edit, reports the files it touched, and its claims are removed.

## Checkpoints

- Tools `checkpoint(reason)` and `revert(checkpoint)` in implement sessions, opt-in per call.
- A checkpoint copies the current content of the files the session holds claims on into `.agent/runs/<id>/checkpoints/<n>/`, with the reason.
- `revert` compares each file's hash with the one recorded at checkpoint time and refuses files that changed underneath; the rest are restored. No git involvement.
- Checkpoint reasons are listed in the transcript; more than three on one plan item marks the item for review in the plan bar.

## Channels

- `send(session, text)` returns immediately. The receiver sees a one-line "1 message waiting" tail on its next tool result and pulls the text with `read_messages()`, which returns it as a tool result.
- The tail repeats until the queue is drained. A session that has stopped calling tools gets the message as its next user turn instead.
- Threads are capped at a configurable length; beyond it the next message is refused and the user is notified in the Sessions view.

Not included: shared memory between sessions, automatic conflict resolution, cross-workspace sessions.

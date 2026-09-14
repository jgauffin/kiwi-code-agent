# Implement phase

A session mode that carries out an approved plan, item by item, and stops when the acceptance criteria are proven.

- Starts from an approved `plan/<feature>.plan.md`; refuses a draft. Fresh session, the plan file is its only input.
- Full tool set (Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery, Bash) plus a task-state tool.
- Task-state tool: `list`, `start(id)`, `done(id, note)`, `blocked(id, reason)`. State lives in the plan file's front-matter so it survives reloads and is visible in git. Item N of M is always known.
- Works one plan item at a time in the plan's order; drift items and feature tasks are the same kind of item.
- Verification is on and cannot be switched off in this mode; it runs at each item boundary, scoped to the projects touched by that item.
- Failure budget per item: after N consecutive failed verifications the item is marked `blocked` with the last error, and the session moves on or stops if nothing else can proceed.
- Termination: the session is done when every acceptance criterion in the spec is bound to a passing test named in the plan, and no item is open. Stopping earlier is blocked the same way a failed verification is.
- The plan bar shows items done / blocked / open.
- Session status: `implementing` while working, `verifying` during verification, `needs_human` when an item is blocked or a permission is pending.
- Per-file-type rules (`kiwiAgent.rules`: match glob, text) are injected as context on the first Edit or Write of a matching file in a session, not in the system prompt.

Not included: claims across sessions, checkpoints, ADO task updates.

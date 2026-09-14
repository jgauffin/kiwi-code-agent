# Edit diff view

Edits made by a session are reviewable as diffs, in the transcript and in the editor.

- A permission card for Edit or Write shows the change as a unified diff instead of raw JSON: old and new text for Edit, full content for a new file, a diff against the current file for an overwrite.
- A completed Edit or Write tool row shows the same diff, collapsed, with the file path clickable to open the file at the first changed line.
- "Open diff" on a row opens VS Code's diff editor between the pre-edit content and the file as it is now.
- Pre-edit content is captured by the extension at permission time, not by the engine, so it works on both engines.
- A session's touched files are listed in the plan bar area (chat mode: a "Changed files" row) with per-file diff links.

Not included: reverting from the diff, multi-file review flows, checkpoints.

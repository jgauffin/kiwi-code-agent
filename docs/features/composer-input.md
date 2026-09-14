# Composer input

The prompt box knows the workspace: files, selections and commands.

- `@` in the composer opens a file picker over the workspace; a chosen file is inserted as a reference and sent as part of the prompt (path plus, for the Claude engine, the same `@file` syntax Claude Code understands; for the own loop, the file content is attached below the prompt with its path).
- "Add selection" button (and a command / context-menu entry in the editor) inserts the current editor selection with its file and line range.
- `/` lists the workspace's skills and commands from `.claude/`; picking one sends it as Claude Code would. On the own-loop engine a skill's `SKILL.md` is attached as context instead.
- Pasted or dropped images are sent as image content on engines that accept it, shown as thumbnails in the transcript.
- Draft text is kept per session, so switching tabs does not lose a half-written prompt.
- Up arrow in an empty composer recalls the previous prompt.

Not included: mentions of other sessions, templates.

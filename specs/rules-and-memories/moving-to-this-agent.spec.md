---
feature: Moving to this agent
status: verified
---

# Moving to this agent

## Goal
A person who comes to this agent from Claude Code arrives with their working life already written down somewhere else: their rules, and their memories among them, sit in `CLAUDE.md` at the workspace's level and at their own. This product standardises on `AGENTS.md`, which both engines read and the whole team sees in their source, so the rules a person already wrote have to travel rather than be typed again. The move is offered once per file, carries everything the file holds, is shown as a change before it is made, and once accepted leaves one file that every session works from.

## Moving from CLAUDE.md to AGENTS.md
A workspace or a person whose rules still sit in `CLAUDE.md`.
- **Offered once per file**: the move is offered once for the workspace's `CLAUDE.md` and once for the person's own, and a declined offer is not raised again (docs/settings.md#Instruction files and skills).
- **Content moves whole**: Accepting the move carries everything the file holds, the person's memories among it, and from then on memories are written to and read from `AGENTS.md`.
  - **Confirmed before the file goes**: the move is shown as a change the person confirms before it is made, and `CLAUDE.md` is removed once it is.
  - **Both files already there**: when `AGENTS.md` already exists its text is left as it was and the `CLAUDE.md` text is appended under a heading saying where it came from.
- **Same rules on both engines after the move**: once moved, a session on either engine works from the one `AGENTS.md` and no rule that reached it before the move stops reaching it (docs/settings.md#Instruction files and skills).

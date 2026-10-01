---
doc: docs/settings.md
---
Every Kiwipow Agent setting: the settings page's tabs, each `kiwiAgent.*` key with its shape and effect, plus where instruction files, MCP servers and logs live.

- `#Instruction files and skills`: which `CLAUDE.md`/`AGENTS.md` paths and `SKILL.md` folders load at user and workspace level, in what order, and which the Claude engine reads itself
- `#MCP servers`: how `.mcp.json` and `~/.mcp.json` give both engines their tools, the `mcp__<server>__<tool>` naming and permission prompts, overriding a user server per workspace, and the one-time copy of Claude Code's `~/.claude.json` servers
- `#Logs`: where session events, system prompts, the repo map, the docs map and a feature's working plan files are written under `.agent/`, and what to gitignore

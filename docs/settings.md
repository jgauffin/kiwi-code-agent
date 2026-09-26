# Settings

*KiwiAgent: Settings* (or the gear in the Sessions and Chat views) opens a page in the editor with four tabs: Models and Advanced write to user settings, Permissions and Project to the workspace. API keys go to the editor's secret storage from the Models tab.

The keys, for settings.json:

- `kiwiAgent.profiles`: one entry per model: `name`, `engine` (`claude-sdk` or `openai-compatible`), `model`, optional `effort` and `systemPromptFile`; `openai-compatible` also takes `baseUrl` and `apiKeySecret`. Defaults: Claude Opus and Sonnet. Example:

  ```json
  { "name": "Kimi K3", "engine": "openai-compatible", "model": "moonshotai/Kimi-K3", "baseUrl": "https://api.berget.ai/v1", "apiKeySecret": "berget" }
  ```
- `kiwiAgent.activeProfile`: profile name used for new sessions; `kiwiAgent.planProfile` overrides it for plan sessions.
- `kiwiAgent.permissions.allow`: shell commands and tools allowed without asking, per project. Read-only tools never ask; a shell call is prompted command by command and can be allowed for the session or the project, or denied.
- `kiwiAgent.nodePath`: Node executable for the Claude engine; empty uses VS Code's executable.
- `kiwiAgent.traceEngine`: one line per Claude engine message in the KiwiAgent output channel, to see what the engine sends (thinking deltas, status) when the UI shows nothing.
- `kiwiAgent.verify`: test commands run once every task of a feature is marked tested, over the files the tasks name, in the directory of the nearest `project` file; a repo with a backend and a frontend runs each suite once, and only the suites the feature touched. A failure is handed to the implement session, up to `kiwiAgent.verifyFailureBudget` consecutive failures. Default: `dotnet test` of the `.csproj` owning a `.cs` file, `npm test` in the `package.json` folder owning a `.ts` file.
- `kiwiAgent.planIgnore`: globs under `docs/` a blind planner must not see. The docs map does not describe them and the docs evaluation does not judge them.
- Command *KiwiAgent: Set API Key for Profile* stores keys for profiles that declare `apiKeySecret`.
- Command *KiwiAgent: Build Docs Map* describes the docs that changed since the last build. A plan session and a docs evaluation do it themselves when the map is behind.

## Instruction files and skills

Claude Code's layout, at the user level and in the workspace. On the own-loop engine `CLAUDE.md` and `AGENTS.md` under `~/.claude/`, `~/.codex/AGENTS.md`, `~/AGENTS.md`, then the workspace's `CLAUDE.md` and `AGENTS.md` join the system prompt, global first. Skills (`<folder>/SKILL.md`) under `~/.claude/skills`, `~/.agent/skills` and the same two folders in the workspace load through the `Skill` tool; the workspace wins on a shared name. The Claude engine reads the workspace's `CLAUDE.md` and skills itself. Details in [features/instructions-and-skills.md](features/instructions-and-skills.md).

## MCP servers

`.mcp.json` in the workspace root (Claude Code's format) gives chat sessions its servers' tools on both engines, as `mcp__<server>__<tool>`. They ask before running unless an allow rule names the tool or `mcp__<server>__*`. A save of the file reaches running sessions; *KiwiAgent: Reload MCP Servers* re-reads it and reconnects every server, and the composer shows each server's status with a reconnect button.

## Logs

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace; add `.agent/` to the workspace's `.gitignore`. Generated context lives beside the logs: the repo map under `.agent/repo-map/` and the docs map under `.agent/docs-map/`, both rebuilt from the workspace and safe to delete.

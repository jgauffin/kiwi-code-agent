# Settings

*Kiwipow Agent: Settings* (or the gear in the Sessions and Chat views) opens a page in the editor with four tabs: Models and Advanced write to user settings, Permissions and Project to the workspace. Models has its own Providers and Profiles sub-tabs. API keys go to the editor's secret storage from the Providers sub-tab, under the provider's own name; a rename carries the stored key with it, so nothing else names it. A `claude-sdk` provider's key is optional: with one, Claude sessions use that Anthropic API key; without one, they use the Claude Code login on this machine.

The keys, for settings.json:

- `kiwiAgent.providers`: where models come from: `name`, `engine` (`claude-sdk` or `openai-compatible`), and `models`, the list to pick from; `openai-compatible` also takes `baseUrl`, and `reasoningControl`: `reasoning_effort` sends a profile's effort as that parameter (low, medium, high; higher levels are sent as high), `none` sends none, absent leaves it to a built-in table of models known to take it. The Providers sub-tab can fill `models` from the endpoint's own list once a base URL and a key, typed or already stored, are both in place. Example:

  ```json
  { "name": "berget", "engine": "openai-compatible", "baseUrl": "https://api.berget.ai/v1", "models": ["moonshotai/Kimi-K3"] }
  ```
- `kiwiAgent.profiles`: a named way to work: `name`, `default` (a `{provider, model}` naming an entry in `kiwiAgent.providers`, plus optional `effort` and `systemPromptFile`), and optional `steps`, one entry per step (`chat`, `plan` (feature planning), `reconcile`, `implement`, `fix`, `cleanup`, `code-plan` (Plan), `docs`, `docs-map`, `file-decisions`) with a model or an effort of its own. A step not named in `steps` still runs, on the default, so a step added later needs no profile changed. `fix` is the run that mends a failed test sweep; it runs on the profile chosen for implement.

  Effort: a step's own, else the one suggested for the step (plan, reconcile and code-plan high, implement, fix, docs and file-decisions medium, cleanup and docs-map low), else the default's. A fix goes one level higher for each sweep in a row that failed. Example, the strongest reasoner for planning and mapping, throughput for the rest:

  ```json
  { "name": "Balanced", "default": { "provider": "Claude", "model": "claude-sonnet-5[1m]" }, "steps": { "plan": { "provider": "Claude", "model": "claude-opus-5[1m]" }, "reconcile": { "provider": "Claude", "model": "claude-opus-5[1m]" } } }
  ```

  On `claude-sdk`, the `[1m]` suffix gives the model its 1M-token context window.
- `kiwiAgent.activeProfile`: the profile name new sessions run on.
- `kiwiAgent.permissions.allow`: shell commands and tools allowed without asking, per project. Read-only tools never ask; a shell call is prompted command by command and can be allowed for the session or the project, or denied.
- `kiwiAgent.permissions.denyGitWrites`: blocks every git command that is not read-only, whatever the allow rules say. Permissions tab, Git.
- `kiwiAgent.nodePath`: Node executable for the Claude engine; empty uses VS Code's executable.
- `kiwiAgent.compactAtTokens`: compact a conversation once it is this large, even when the window holds more, since every request re-sends it; 0 compacts only when the window runs short. Settings page, Advanced tab. A provider can set its own per model (`compactAtTokens` on the provider, model id → tokens), edited beside each model under Models › Providers; that wins for sessions on that provider and model.
- `kiwiAgent.traceEngine`: one line per Claude engine message in the Kiwipow Agent output channel, to see what the engine sends (thinking deltas, status) when the UI shows nothing.
- `kiwiAgent.verify`: test commands run once every task of a feature is marked tested, over the files the tasks name, in the directory of the nearest `project` file; a repo with a backend and a frontend runs each suite once, and only the suites the feature touched. A failure is handed to the implement session, up to `kiwiAgent.verifyFailureBudget` consecutive failures. Default: `dotnet test` of the `.csproj` owning a `.cs` file, `npm test` in the `package.json` folder owning a `.ts` file.
- `kiwiAgent.planIgnore`: globs under `docs/` feature planning must not see. The docs map does not describe them and the docs evaluation does not judge them.
- Command *Kiwipow Agent: Build Docs Map* describes the docs that changed since the last build. A planning session and a docs evaluation do it themselves when the map is behind.
- `kiwiAgent.docsMap.style`: `described` (default) has a model write one line per section; `outline` gives headings with line ranges and each doc's opening paragraph, read at session start at no model cost. Set it to compare the two.

## Instruction files and skills

Claude Code's layout, at the user level and in the workspace. On the own-loop engine `CLAUDE.md` and `AGENTS.md` under `~/.claude/`, `~/.codex/AGENTS.md`, `~/AGENTS.md`, then the workspace's `CLAUDE.md` and `AGENTS.md` join the system prompt, global first. Skills (`<folder>/SKILL.md`) under `~/.claude/skills`, `~/.agent/skills` and the same two folders in the workspace load through the `Skill` tool; the workspace wins on a shared name. The Claude engine reads the workspace's `CLAUDE.md` and skills itself. Details in [features/instructions-and-skills.md](features/instructions-and-skills.md).

## MCP servers

`.mcp.json` (Claude Code's format) gives chat sessions its servers' tools on both engines, as `mcp__<server>__<tool>`. They ask before running unless an allow rule names the tool or `mcp__<server>__*`. A save of the file reaches running sessions, and the composer shows each server's status with a reconnect button.

`~/.mcp.json` holds the servers every workspace gets and the workspace's own `.mcp.json` goes over it, so a workspace can replace a user server by name. Only the workspace file is watched; a change to the user's takes effect on the next window.

Claude Code itself keeps the user's servers in `~/.claude.json` instead, under `mcpServers`. The first time it runs, Kiwipow Agent copies them into `~/.mcp.json` so both read the same list — verbatim, `${VAR}` placeholders and all, leaving out any name the format refuses. It copies only when there is no `~/.mcp.json` yet, so a server removed afterwards stays removed; to run the copy again, delete the file. Servers Claude Code holds per project (`projects` in `~/.claude.json`) are left where they are.

## Logs

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace, and a session's system prompt, when its mode composes one, to `system-prompt.md` beside it; add `.agent/` to the workspace's `.gitignore`. Generated context lives beside the logs: the repo map under `.agent/repo-map/` and the docs map under `.agent/docs-map/`, both rebuilt from the workspace and safe to delete. A feature's review, decisions and tasks live under `.agent/plan/` until the feature is finished (see [plan-sessions.md](plan-sessions.md)).

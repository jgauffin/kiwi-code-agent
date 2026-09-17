# KiwiCodeAgent

![A mad motha f00ker bird logo for them to see](/docs/kiwi-bird-320.png)

***still early, nothing to try yet***

VS Code extension that runs coding sessions with a choice of engine per session.

- **Claude**: the Agent SDK's JavaScript build of Claude Code (`dist/cli.mjs`), spawned under Node with the login Claude Code already has. No native binary. Gets the extension's own tools (JsonSchema, JsonQuery) through an in-process MCP server, shown under their bare names.
- **Any OpenAI-compatible endpoint** (tested with GLM-5.3-Flash and Kimi K3 through Berget AI): own loop with Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery and Bash. The JSON tools stream a file and return its shape or the rows an expression selects, so a large JSON file never has to be read whole. Read-only tools run without asking; the rest prompt. A shell call is prompted command by command, each allowed for the session or the project (`kiwiAgent.permissions.allow`) or denied. Add a profile with `baseUrl`, `model` and `apiKeySecret`, then run *KiwiAgent: Set API Key for Profile*.

The three-phase design (blind plan, map against code, implement) is the goal; `docs/intent/agent.md` is the definition.

The sidebar has a Sessions view (every session, with status) and the Chat view: tabs for the sessions in play with a status icon (📐 planning, 🔧 implementing, ✋ needs you, ⚠ error, ○ waiting), a `+` tab that opens the new-session screen, then the transcript. The new-session screen picks the model and the plan model; the gear in either view opens the settings page.

Session modes:

- **Chat**: work in the code with the full tool set.
- **Plan**: blind planning of one feature. The session can read `docs/**`, the root README and every `plan/*.spec.md`, never the code, enforced at the tool call, and writes `plan/<feature>.spec.md` to a contract: a goal, one section per scenario holding named rules with their edge cases nested under the rule they qualify, open questions, `status: draft`. An approved spec is the feature's definition, and the next feature is planned from it as from the docs. A rule's name is the bold lead-in of its line and is what a comment, a task, a test and a decision refer to. A write that departs from the contract is answered on the spot and the plan bar offers Repair. The first prompt is the feature or user story description. Writing the spec needs no permission prompt; a write into `docs/` is prompted, and made only when asked. A bar above the transcript switches between the plan (Plan) and the conversation (Chat), names the feature's stage and offers the next step; the view follows the work: Chat while the planner responds, Plan when its turn ends.

The Plan view is one card per scenario and follows the stage: comment on and strike rules while the spec is a draft, resolve the planner's answers; once the review is closed (or from the bar on an uncommented spec) the spec is mapped against the code, which writes `plan/<feature>.decisions.md` (what the code says against what the spec says, with the planner's change options) and `plan/<feature>.tasks.md`, one task per scenario by default, with the files each touches; every rule shows which task delivers it. Decisions are ruled in a wizard, one at a time: change the spec one of the proposed ways, keep the spec so the code changes, or your own words. Send rulings hands them to the planner to revise the rules, the board is re-mapped, and Approve sets `status: approved`; the planner then lists in chat what the docs should now say differently, for you to change or ask it to. Implement works the tasks and marks each `[in progress]`, `[done]`, `[tested]` or `[blocked: reason]`, naming on a `proves:` line the test that proves each delivered rule, which the view shows on the rule; once every task is tested the `kiwiAgent.verify` test commands run over the tasks' files and the outcome is recorded in the tasks file. *KiwiAgent: Migrate plans* brings plans written before the contract into it; old ids become names until the planner is asked to name them.

## Develop

```
npm install
npm test          # no network or engine needed
npm run build     # dist/: extension, webview, cli.mjs, ripgrep
```

F5 launches the Extension Development Host. Open the "KiwiAgent" view in the activity bar.

## Develop with it

Load the extension from this repo in your normal VS Code instead of a packaged copy:

```
npm run link-dev   # installs the .vsix so VS Code registers it, then points the installed folder at this repo
```

Reload the window once. From then on, after `npm run build` (or the `npm: watch` task) the extension notices its own bundle changed and offers "Reload Window". Sessions and the open session survive the reload; engines resume on the next prompt. `npm run unlink-dev` removes the link.

## Install elsewhere

```
npm run package   # kiwi-agent-<version>.vsix
code --install-extension kiwi-agent-<version>.vsix
```

Requires Node in the environment only if `kiwiAgent.nodePath` is set; otherwise VS Code's own executable runs the engine in Node mode.

## Settings

*KiwiAgent: Settings* (or the gear in the Sessions and Chat views) opens a page in the editor with four tabs: Models and Advanced write to user settings, Permissions and Project to the workspace. API keys go to the editor's secret storage from the Models tab. The keys, for settings.json:

- `kiwiAgent.profiles`: one entry per model: `name`, `engine` (`claude-sdk` or `openai-compatible`), `model`, optional `effort` and `systemPromptFile`; `openai-compatible` also takes `baseUrl` and `apiKeySecret`. Defaults: Claude Opus and Sonnet. Example:

  ```json
  { "name": "Kimi K3", "engine": "openai-compatible", "model": "moonshotai/Kimi-K3", "baseUrl": "https://api.berget.ai/v1", "apiKeySecret": "berget" }
  ```
- `kiwiAgent.activeProfile`: profile name used for new sessions; `kiwiAgent.planProfile` overrides it for plan sessions.
- `kiwiAgent.nodePath`: Node executable for the Claude engine; empty uses VS Code's executable.
- `kiwiAgent.traceEngine`: one line per Claude engine message in the KiwiAgent output channel, to see what the engine sends (thinking deltas, status) when the UI shows nothing.
- `kiwiAgent.verify`: test commands run once every task of a feature is marked tested, over the files the tasks name, in the directory of the nearest `project` file; a repo with a backend and a frontend runs each suite once, and only the suites the feature touched. A failure is handed to the implement session, up to `kiwiAgent.verifyFailureBudget` consecutive failures. Default: `dotnet test` of the `.csproj` owning a `.cs` file, `npm test` in the `package.json` folder owning a `.ts` file.
- Command *KiwiAgent: Set API Key for Profile* stores keys for profiles that declare `apiKeySecret`.
- `.mcp.json` in the workspace root (Claude Code's format) gives chat sessions its servers' tools on both engines, as `mcp__<server>__<tool>`. They ask before running unless an allow rule names the tool or `mcp__<server>__*`. A save of the file reaches running sessions; *KiwiAgent: Reload MCP Servers* re-reads it and reconnects every server, and the composer shows each server's status with a reconnect button.

Session events are logged to `.agent/runs/<session id>/events.jsonl` in the workspace; add `.agent/` to the workspace's `.gitignore`.

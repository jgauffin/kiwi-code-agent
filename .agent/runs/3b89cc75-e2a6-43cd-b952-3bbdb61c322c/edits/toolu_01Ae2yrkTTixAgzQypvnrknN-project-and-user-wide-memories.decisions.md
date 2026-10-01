# Decisions for Project and User wide memories

### The Claude engine already excludes user-level settings
- on: Same memories on both engines, No second copy on the Claude engine, Project or user scope
- finding: `SdkSession.buildOptions` in src/agent/sdk-session/sdk-session.ts sets `settingSources: ['project', 'local']`, deliberately leaving out `'user'` because "the user's global settings... belong to this machine, not the repo"; the own loop's `readInstructionFiles` (src/agent/instructions/instruction-files.ts) still injects the home-directory `CLAUDE.md`/`AGENTS.md` itself. The rules assume a Claude engine session reads memory at every scope natively, without a second copy put in front of it.

### Project scope already means the committed workspace settings
- on: Project or user scope, Memories stay out of the repository
- finding: `TARGETS` in src/settings/settings-store.ts puts every project-level setting (`permissions.allow`, `verify`, `cleanup.*`, `planIgnore`, ...) on VS Code's `workspace` target, i.e. the project's own, normally committed `.vscode/settings.json`; that is what "project" scope already means in this codebase, while the rule requires a project memory to stay out of the repository.

### Session context is fixed at engine creation
- on: Memory written mid-session, Every session that may read the code starts with the memories
- finding: `SessionEngines.withMap` and `withRepoMap` (src/session-engines.ts, src/agent/repo-map/session-context.ts) bake the repo map into the static system prompt once, "at engine creation, so the map a session works from is fixed for the life of that engine" — the same pattern `withDocs` uses for the docs map. Nothing updates a running session's system prompt, which a memory written mid-session needs in order to be in hand for the rest of that session without a restart.

### Code-plan and cleanup sessions already read the code too
- on: Every session that may read the code starts with the memories
- finding: `CODE_PLAN_TOOLS` and `CLEANUP_TOOLS` (src/agent/phases/code-plan.ts, src/agent/phases/cleanup.ts) already give the code-plan and cleanup sessions `CodeOutline`/`CodeSearch`/`Grep`, and the `code-plan` case in `modeSetup` (src/agent/session/mode-setup.ts) already composes its prompt through `ctx.withMap`; the rule names only chat, the check against the code, and implement.

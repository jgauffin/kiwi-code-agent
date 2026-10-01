# Where Project and User wide memories is built

## Remembering what the person settled
- src/agent/phases/unfiled-decisions.ts — the sibling pattern for a working note written from chat: `CHAT_DECISIONS`/`UNFILED_DECISIONS` prompt text, the `### Title` + fields file shape, `UnfiledContract` hook that tells the model what does not fit right after it writes
- src/agent/openai-session/system-prompt.ts — own-loop system prompt assembly (`buildSystemPrompt`), where a "write a memory" instruction joins `CHAT_DECISIONS` and the other standing instructions
- src/session-engines.ts — `startClaude`/`startOpenAi`, where the fallback `appendSystemPrompt` (Claude engine) and `systemPrompt` (own loop) are assembled; `settingSources` for the Claude engine
- src/agent/sdk-session/sdk-session.ts — `buildOptions`, `settingSources: ['project', 'local']`, the Claude engine's native file reading
- src/agent/instructions/instruction-files.ts — precedent for a user-and-workspace, two-level file set (`instructionFilePaths`, `readInstructionFiles`)
- src/settings/settings-store.ts — `TARGETS`, the existing user/workspace split for settings, and its `'workspace'` target writing to the committed settings file
- src/agent/agent-dir-ignore.ts — precedent for keeping generated/local files out of the repository under `.agent/`
- src/agent/session/hooks.ts — `composeHooks`, how a mode's hooks (a memory-writing hook among them) compose with the shared ones

## Starting a session with what is already known
- src/agent/session/mode-setup.ts — `ModeContext`, `modeSetup`; where `withMap`/`withDocs` are called per mode, the natural home for a `withMemories` of the same shape; confirms `plan` (blind feature planning) never calls `withMap` and the `chat` mode composes no systemPrompt of its own
- src/session-engines.ts — `modeContext`, `withMap`, `withDocs`; the engine-creation-time, fixed-for-the-session-life pattern those helpers already follow
- src/agent/repo-map/session-context.ts — `repoMapSection`, `withRepoMap`; the exact shape (note + summary, appended to the system prompt) a memory index section would follow
- src/agent/docs-map/session-context.ts — `withDocsMap`; the same pattern for the docs map, including the per-mode "wants this context" gate
- src/agent/phases/blind-plan.ts — `blindPlanPrompt`; confirms the blind planner's prompt is built from `withDocs` alone, never `withMap`
- src/agent/phases/reconcile.ts, src/agent/phases/implement.ts — `reconcilePrompt`, `implementPrompt`; the two other sessions the rule names, both composed through `ctx.withMap`
- src/agent/phases/code-plan.ts, src/agent/phases/cleanup.ts — `CODE_PLAN_TOOLS`, `CLEANUP_TOOLS`; sessions with code-reading tools the rule does not name
- src/agent/openai-session/system-prompt.ts — the own loop's default prompt for an unscoped chat

## Reviewing and forgetting
- src/settings/webview/project-tab.ts, src/settings/webview/profiles-tab.ts — precedent list/edit/remove UI for a named, per-scope collection
- src/settings/protocol.ts, src/settings/settings-panel.ts — the settings page's tabs and the snapshot/save protocol a Memories tab would join
- src/settings/settings-store.ts — where a new storage scope would be read and written
- src/agent/docs-map/doc-index.ts — `scanDocs`, `diffDocs`, `readDocsIndex`; the precedent for an index rebuilt from the source files when they drift, matching "notes are the truth"
- src/agent/docs-map/map-files.ts — `listEntries`, `removeEntry`; precedent for listing and deleting one entry of a generated index
- src/chat/protocol.ts — `RememberedRules`, the existing session/project scope split for permission rules, as prior art for a scope picker in the UI

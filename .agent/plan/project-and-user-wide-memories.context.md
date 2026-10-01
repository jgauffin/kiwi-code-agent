# Where Project and User wide memories is built

## Remembering what the person settled
- src/agent/phases/unfiled-decisions.ts
- src/agent/openai-session/system-prompt.ts
- src/session-engines.ts
- src/agent/sdk-session/sdk-session.ts
- src/agent/instructions/instruction-files.ts
- src/settings/settings-store.ts
- src/agent/agent-dir-ignore.ts
- src/agent/session/hooks.ts

## Starting a session with what is already known
- src/agent/session/mode-setup.ts
- src/session-engines.ts
- src/agent/repo-map/session-context.ts
- src/agent/docs-map/session-context.ts
- src/agent/phases/blind-plan.ts
- src/agent/phases/reconcile.ts
- src/agent/phases/implement.ts
- src/agent/phases/code-plan.ts
- src/agent/phases/cleanup.ts

## Reviewing and forgetting
- src/settings/webview/project-tab.ts
- src/settings/webview/profiles-tab.ts
- src/settings/protocol.ts
- src/settings/settings-panel.ts
- src/settings/settings-store.ts
- src/agent/docs-map/doc-index.ts
- src/agent/docs-map/map-files.ts
- src/chat/protocol.ts

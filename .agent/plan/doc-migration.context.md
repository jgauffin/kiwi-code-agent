# Where Doc migration is built

## Starting the job
- src/chat/webview/new-session-view.ts
- src/agent/session/session-manager.ts
- src/agent/session/mode-setup.ts
- src/agent/phases/docs-evaluation.ts
- src/agent/phases/file-decisions.ts

## Pruning what a spec already says
- src/agent/phases/blind-plan.ts
- src/chat/chat-view-provider.ts
- src/agent/phases/docs-evaluation.ts
- src/agent/phases/spec-file.ts
- src/agent/phases/scope-guard.ts
- src/agent/phases/file-decisions.ts
- plan/unfiled-decisions.md

## Migrating the remaining feature docs into specs
- src/agent/phases/blind-plan.ts
- src/agent/phases/spec-model.ts
- src/agent/phases/spec-file.ts
- src/chat/chat-view-provider.ts

## Verifying a migrated feature against the code
- src/agent/phases/reconcile.ts
- src/agent/phases/decisions.ts
- src/agent/phases/spec-file.ts
- src/agent/phases/plan-stage.ts
- src/agent/phases/plan-housekeeping.ts
- src/agent/phases/tasks-file.ts

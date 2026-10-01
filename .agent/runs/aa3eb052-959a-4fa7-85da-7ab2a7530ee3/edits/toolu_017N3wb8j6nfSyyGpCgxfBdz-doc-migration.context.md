# Where Doc migration is built

## Starting the job
- src/chat/webview/new-session-view.ts (the Maintenance tab's cards; `docs`/`file-decisions` are the pattern a third card follows)
- src/agent/session/session-manager.ts (`SessionMode`, `isPlanning`, `isFeatureless`, `STEPS`, `titleFor`)
- src/agent/session/mode-setup.ts (per-mode hooks, prompt, tool set and read scope)
- src/agent/phases/docs-evaluation.ts and src/agent/phases/file-decisions.ts (the two existing maintenance jobs' scope/prompt/kickoff shape to follow)
- src/chat/sessions-tree.ts (how a featureless maintenance session is listed)

## Pruning what a spec already says
- src/agent/phases/blind-plan.ts (`docsReviewPrompt`, `docsCutPrompt`, `docsAfterApprovalPrompt`, `DOCS_DIR`/`PLAN_DIR`/`SPECS_GLOB`, `featureSlug`: the existing per-feature doc-listing this job's stage 1 generalises to every settled spec)
- src/chat/chat-view-provider.ts (`cutCoveredDocs()` read, the two `sendToPlanner(..., docsAfterApprovalPrompt(...))` call sites)
- src/agent/phases/docs-evaluation.ts (`docsEvaluationScope`, the load-bearing-heading check against spec citations)
- src/agent/phases/spec-file.ts (`statusOf`: which specs are settled)
- src/agent/phases/scope-guard.ts (`Scope`, `readableIn`: how a mode's read/write/ask scope is expressed)
- plan/unfiled-decisions.md (`UNFILED_FILE` in src/agent/phases/file-decisions.ts: where a ruled contradiction is recorded)

## Migrating the remaining feature docs into specs
- assets/plugin/skills/spec-writing/contract.md (the spec contract a migrated draft is held to)
- src/agent/phases/blind-plan.ts (`blindPlanPrompt`, `PLAN_DIR`, `featureSlug`, the draft-writing shape)
- src/agent/phases/spec-model.ts (`parseSpec`, `SpecContract`: the contract enforcement a migrated draft's writes are checked against)
- src/agent/phases/spec-file.ts (`withFrontMatterValue`/`withStatus`: writing `status: draft`)
- src/chat/chat-view-provider.ts (how a draft spec appears in the Sessions/Plan view for review and approval)

## Verifying a migrated feature against the code
- src/agent/phases/reconcile.ts (`reconcileScope`, `reconcilePrompt`: the ordinary check a migrated spec's approval runs)
- src/agent/phases/decisions.ts (`Decision`, `readDecisions`, `assertAllRuled`: how disagreements are recorded and ruled)
- src/agent/phases/spec-file.ts (`SpecStatus`, `statusOf`, `setSpecStatus`: the only states a spec may hold)
- src/agent/phases/plan-stage.ts (`planStage`, `checkDue`: how a clean check today leads to a task board, never straight to `implemented`)
- src/agent/phases/plan-housekeeping.ts (`sweepPlans`: today's only path to `status: implemented`)
- src/agent/phases/tasks-file.ts (`deriveBoard`, `tasksDone`, `unprovenItems`: the board and proof bookkeeping a built-already spec would skip)

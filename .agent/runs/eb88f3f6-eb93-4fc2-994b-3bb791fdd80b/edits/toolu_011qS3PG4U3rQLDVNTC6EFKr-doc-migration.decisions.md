# Decisions for Doc migration

### The existing per-feature doc listing never separates contradiction from coverage
- on: Covered section, Contradicting section
- finding: `docsReviewPrompt` and `docsCutPrompt` in `src/agent/phases/blind-plan.ts` (run on every feature's approval, per `docs/intent/agent.md#Docs split`) tell the planner to list, and with `cutCoveredDocs` on cut, "what now reads differently from the spec or is covered by it" as one bucket that "can go" or be cut outright, with no step asking which side is current. The spec requires a contradicting section to be reported but never offered for removal until the person says the doc is wrong.

### A spec can reach `implemented` only through a verified, swept task board
- on: Clean check on built behaviour, No proofs expected
- finding: `statusOf`/`setSpecStatus` in `src/agent/phases/spec-file.ts` accept only `draft`, `approved` and `implemented`, and the only writer of `implemented` is `sweepPlans` in `src/agent/phases/plan-housekeeping.ts`, which requires a task board whose tasks are all `tested` and verified (and only a week after the feature was last touched). `planStage` in `src/agent/phases/plan-stage.ts` likewise treats `approved` with no board as still `checking`/`ruling`, never `verified`. The spec's rule sets `implemented` straight off a clean check, with no board and no verification at all.

# Decisions for Doc migration

### The existing per-feature doc listing never separates contradiction from coverage [applied]
- on: Covered section, Contradicting section
- finding: `docsReviewPrompt` and `docsCutPrompt` in `src/agent/phases/blind-plan.ts` (run on every feature's approval, per `docs/intent/agent.md#Docs split`) tell the planner to list, and with `cutCoveredDocs` on cut, "what now reads differently from the spec or is covered by it" as one bucket that "can go" or be cut outright, with no step asking which side is current. The spec requires a contradicting section to be reported but never offered for removal until the person says the doc is wrong.
- proposed: A section whose behaviour a settled spec now defines, or that reads differently from it, is reported in one listing marked per section as covered or differing, and offered for removal either way.
- proposed: A section that reads differently from a settled spec is reported in the same listing as the covered ones and offered for removal only after the person has said which side is current.
- recommended: keep
- because: A doc the person still holds to be current is the only word on that behaviour, and a job whose purpose is a single source of truth must not be able to delete it before they have said which side wins.
- ruling: keep

### A spec can reach `implemented` only through a verified, swept task board
- on: Clean check on built behaviour, No proofs expected
- finding: `statusOf`/`setSpecStatus` in `src/agent/phases/spec-file.ts` accept only `draft`, `approved` and `implemented`, and the only writer of `implemented` is `sweepPlans` in `src/agent/phases/plan-housekeeping.ts`, which requires a task board whose tasks are all `tested` and verified (and only a week after the feature was last touched). `planStage` in `src/agent/phases/plan-stage.ts` likewise treats `approved` with no board as still `checking`/`ruling`, never `verified`. The spec's rule sets `implemented` straight off a clean check, with no board and no verification at all.
- proposed: A spec marked as behaviour already built whose check reports nothing is approved with a task board whose tasks only add the tests that prove its rules, and reaches implemented the usual way once those tests pass.
- proposed: A spec marked as behaviour already built whose check reports nothing reaches implemented once the verify sweep over the files the check named has passed.
- proposed: A spec marked as behaviour already built whose check reports nothing stays approved until the person marks it implemented themselves.
- recommended: 1
- because: It keeps implemented meaning one thing everywhere — every rule proven by a passing test — and the work it asks for is only the tests the existing behaviour was never given.
- ruling: A spec marked as behaviour already built whose check reports nothing is approved with a task board whose tasks only add the tests that prove its rules, and reaches implemented the usual way once those tests pass.

# Plan sessions

Blind planning of one feature. The session can read `docs/**`, the root README and every `plan/*.spec.md`, never the code, enforced at the tool call, and writes `plan/<feature>.spec.md` to a contract: a goal, one section per scenario holding named rules with their edge cases nested under the rule they qualify, open questions, `status: draft`. An approved spec is the feature's definition, and the next feature is planned from it as from the docs. A rule's name is the bold lead-in of its line and is what a comment, a task, a test and a decision refer to. A write that departs from the contract is answered on the spot and the plan bar offers Repair. The first prompt is the feature or user story description. Writing the spec needs no permission prompt; a write into `docs/` is prompted, and made only when asked.

`docs/intent/agent.md` says why planning is blind and how the phases fit together.

## The view

A bar above the transcript switches between the plan (Plan) and the conversation (Chat), names the feature's stage and offers the next step; the view follows the work: Chat while the planner responds, Plan when its turn ends.

The Plan view is one card per scenario and follows the stage:

- **Draft**: comment on and strike rules, resolve the planner's answers.
- **Mapped**: once the review is closed (or from the bar on an uncommented spec) the spec is mapped against the code, which writes `plan/<feature>.decisions.md` (what the code says against what the spec says, with the planner's change options) and `plan/<feature>.tasks.md`, one task per scenario by default, with the files each touches; every rule shows which task delivers it.
- **Decisions**: ruled in a wizard, one at a time: change the spec one of the proposed ways, keep the spec so the code changes, or your own words. Send rulings hands them to the planner to revise the rules and the board is re-mapped.
- **Approved**: Approve sets `status: approved`; the planner then lists in chat what the docs should now say differently, for you to change or ask it to.
- **Implement**: works the tasks and marks each `[in progress]`, `[done]`, `[tested]` or `[blocked: reason]`, naming on a `proves:` line the test that proves each delivered rule, which the view shows on the rule. Once every task is tested the `kiwiAgent.verify` test commands run over the tasks' files and the outcome is recorded in the tasks file (see [settings.md](settings.md)).

*KiwiAgent: Migrate plans* brings plans written before the contract into it; old ids become names until the planner is asked to name them.

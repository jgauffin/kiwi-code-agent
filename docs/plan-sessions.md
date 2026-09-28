# Plan sessions

Blind planning of one feature. The session can read `docs/**`, the root README and every `plan/*.spec.md`, never the code, enforced at the tool call, and writes `plan/<feature>.spec.md` to a contract: a goal, one section per scenario holding named rules with their edge cases nested under the rule they qualify, open questions, `status: draft`. An approved spec is the feature's definition, and the next feature is planned from it as from the docs. A rule's name is the bold lead-in of its line and is what a comment, a task, a test and a decision refer to. A write that departs from the contract is answered on the spot and the plan bar offers Repair. The first prompt is the feature or user story description. Writing the spec needs no permission prompt; a write into `docs/` is prompted, and made only when asked.

`docs/intent/agent.md` says why planning is blind and how the phases fit together.

## Finding the way around the docs

The session starts with the docs map: every doc it may read, what that doc is for, and one line per heading. It opens one file instead of the tree, and cites a section as `path#Heading` with the heading spelled as the map spells it. The map is built from the docs alone, so a blind session reading it stays blind, and a rebuild re-reads only the docs whose content changed. *KiwiAgent: Build Docs Map* builds it on demand; a plan session builds it first when it is behind.

*Evaluate docs*, on the new-session screen, is the other side of that: a session with the planner's own read scope that says in chat where the docs' arrangement costs a planner (what has to be read whole, what cannot be cited, what nothing links to) and changes what you pick, one confirmed write at a time. It never proposes renaming a heading an approved spec cites without naming the citations that would have to follow.

## The view

A bar above the transcript switches between the plan (Plan) and the conversation (Chat), names the feature's stage and offers the next step; the view follows the work: Chat while the planner responds, Plan when its turn ends.

The Plan view is one card per scenario and follows the stage:

- **Draft**: comment on and strike rules, resolve the planner's answers.
- **Approved**: Approve, once every comment is closed, sets `status: approved` and checks the spec against the code. Only disagreements are reported, into `.agent/plan/<feature>.decisions.md` (what the code says against what the spec says, with the planner's change options). With none, the build starts without asking anything.
- **Decisions**: ruled in a wizard, one at a time: change the spec one of the proposed ways, keep the spec so the code changes, or your own words. Send rulings hands them to the planner to revise the rules, and the check runs again.
- **Clean**: the task board `.agent/plan/<feature>.tasks.json` is derived from the spec, one task per scenario, so every rule shows which task delivers it. The planner lists in chat what the docs should now say differently, for you to change or ask it to. When that turn ends the implementation starts on its own.
- **Implement**: one run per task, each started on the task, its rules, any finding you ruled to keep and what earlier tasks built, moving it to tested or blocked with a reason and naming per delivered rule the test that proves it, which the view shows on the rule. Once every task is tested the `kiwiAgent.verify` test commands run over the tasks' files and the outcome is recorded on the board (see [settings.md](settings.md)).

The spec is committed; the review, decisions and tasks are working files under `.agent/plan/`. A week after they were last touched, the working files of a verified feature, or of a spec that is gone, are deleted when the extension starts, and the verified feature's spec is marked `status: implemented` first. A draft or a feature still being built keeps them however old.

*KiwiAgent: Migrate plans* brings plans written before the contract into it; old ids become names until the planner is asked to name them.

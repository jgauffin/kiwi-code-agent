# Plan sessions

The new-session screen is in two tabs: **Code**, the session types that work in the code, and **Maintenance**, the jobs that keep the intent the code is planned from in order, one per input: *Clean up docs* works from the docs, *File decisions* from the decisions you recorded. They are nobody's errand of the day, so they wait apart from the work.

Two modes on the Code tab:

- **Plan**: for work the code shapes, such as a UI on its framework and components. The planner first says in chat what it understands you want and asks what is unclear, before it reads any code, so the plan follows your intent rather than what the code suggests. Then it reads the code and proposes the plan in chat, read-only, with the repo map in its prompt; it searches the docs and specs for what the request names rather than carrying the docs map. No spec, review or task board. *Approve plan* carries the conversation into a chat with the full tool set, which starts building the agreed plan on the profile's Build model and effort.
- **Feature planning**: the rest of this page.

## Feature planning

Blind planning of one feature. The session can read `docs/**`, the root README and every `specs/*.spec.md`, never the code, enforced at the tool call, and writes `specs/<feature>.spec.md` to a contract: a goal (one paragraph: who, what, why), one section per scenario holding named rules with their edge cases nested under the rule they qualify, open questions, `status: draft`. An approved spec is the feature's definition, and the next feature is planned from it as from the docs. A rule's name is the bold lead-in of its line and is what a comment, a task, a test and a decision refer to. A write that departs from the contract is answered on the spot and the plan bar offers Repair. The first prompt is the feature or user story description. Writing the spec needs no permission prompt; a write into `docs/` is prompted, and made only when asked.

`docs/intent/agent.md` says why planning is blind and how the phases fit together.

### Finding the way around the docs

The session starts with the docs map: every doc it may read with its length, what that doc is for, and one line per heading with the section's line range. It reads one section instead of the tree, and cites a section as `path#Heading` with the heading spelled as the map spells it. The map is built from the docs alone, so a blind session reading it stays blind, and a rebuild re-reads only the docs whose content changed. *Kiwipow Agent: Build Docs Map* builds it on demand; a plan session builds it first when it is behind.

*Clean up docs*, on the new-session screen's Maintenance tab, is the other side of that: a session with the planner's own read scope that leaves behaviour in the specs and everything else in docs a planner can find and cite. It works in three stages, each proposed in chat before anything is written, and you can stop after any of them: it cuts what a settled spec already says, turns behaviour no spec holds into draft specs, and then fixes what makes the rest hard to find or cite (what has to be read whole, what cannot be cited, what nothing links to). Each change to a doc is one confirmed write. It never proposes renaming a heading an approved spec cites without naming the citations that would have to follow. It never reads the code, so work past the docs belongs in a chat.

### The view

A bar above the transcript switches between the plan (Plan) and the conversation (Chat), names the feature's stage and offers the next step; the view follows the work: Chat while the planner responds, Plan when its turn ends.

The Plan view is one card per scenario and follows the stage:

- **Approved**: Approve, once every comment is closed, sets `status: approved` and checks the spec against the code. Only disagreements are reported, into `.kiwi/specs/<feature>.decisions.md` (what the code says against what the spec says, with the planner's change options and the one it recommends). With none, the build starts without asking anything.
- **Decisions**: ruled in a wizard, one at a time: change the spec one of the proposed ways, keep the spec so the code changes, or your own words. Send rulings hands them to the planner to revise the rules, and the check runs again.
- **Clean**: the task board `.kiwi/specs/<feature>.tasks.json` is derived from the spec, one task per scenario, so every rule shows which task delivers it. Each task's context is the files its scenario builds on, which the check writes to `.kiwi/specs/<feature>.context.md` while it reads the code, so the implementer starts there instead of searching. The planner lists in chat what the docs should now say differently, for you to change or ask it to. When that turn ends the implementation starts on its own.
- **Implement**: one run per task, each started on the task, its rules, any finding you ruled to keep and what earlier tasks built, moving it to tested or blocked with a reason and naming per delivered rule the test that proves it, which the view shows on the rule. Once every task is tested the `kiwiAgent.verify` test commands run over the tasks' files and the outcome is recorded on the board (see [settings.md](settings.md)).

The spec is committed; the review, decisions and tasks are working files under `.kiwi/specs/`. The spec's `status` records where its feature stands as the work moves (`draft`, `approved` once you approve it, `implemented` once every task is tested, `verified` once the test commands pass), so the committed file says it and never lags the board. The board is the live word while it exists: reopen a task or fail a re-run and the status falls back with it. A week after they were last touched, the working files of a verified feature, or of a spec that is gone, are deleted when the extension starts. A draft or a feature still being built keeps them however old.

*Kiwipow Agent: Migrate plans* brings plans written before the contract into it; old ids become names until the planner is asked to name them.

### From a chat

A chat answers where a feature stands from its files, and writes draft specs from the docs when asked: it proposes the feature list first, and each spec is held to the same contract. This is the way into a project with docs but no specs yet. Each draft then appears in the Sessions view to review and approve as usual.

### Unfiled decisions

What you decide outside planning reaches the next planner. An answer to an implementer's question amends the rules of the task it asked about. Anything that reaches further, from an implement run, a plan session, a code plan or a chat, goes into one of two files, which the planner reads as your latest word. Each entry is `### Title`, `- decided:` and `- affects:`. `specs/unfiled-decisions.md` holds how the product works, and is filed as rules into the specs it reaches. `specs/future-work.md` holds work you decided on for later, and goes to the docs as what the product should do, named as a feature to plan, since a spec's rules are what its build delivers. A code plan lists both kinds at its end, and the build records them before it starts. The Maintenance tab of the new-session screen counts how many entries are waiting in both; *File decisions* there is a session with the planner's read scope. It proposes where each entry goes, amends the specs and docs you pick, one confirmed write at a time, and deletes an entry once it is filed. A verified spec is not amended: the change is a feature to plan.

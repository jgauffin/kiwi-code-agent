# Implement phase

A session mode that carries out an approved spec task by task, and is finished when every task is tested and the test commands pass.

- Starts from the plan bar's Implement on an approved, mapped spec; refuses a draft or a spec without a tasks file. It continues the mapping run's conversation where the engine resumes, a fresh session otherwise; Implement on a feature that already has an implement session carries that session on.
- Full tool set (Read, Write, Edit, Glob, Grep, JsonSchema, JsonQuery, Bash). Writes go through the ordinary permission prompt.
- Reads `plan/<feature>.decisions.md` for the rulings: a decision ruled `keep` means the rule stands and the code changes, done with the task that touches it.
- Task state is the tasks file: `[in progress]`, `[done]`, `[tested]`, `[blocked: reason]` appended to the task's line, so task 4 of 7 survives a fresh session. A `proves:` line names, per delivered rule, the test file and the test whose name states the rule.
- Only `[tested]` is a finish. The board goes to verification once every task is tested; the plan bar then stops offering Implement. A blocked task is unfinished work and takes a fresh session.
- Verification is mechanical: the test commands from `kiwiAgent.verify` run over the files the tasks name when an implement turn ends with the board all tested and no passing run recorded since. A failure goes back to the implement session with the command and its output, up to `kiwiAgent.verifyFailureBudget` consecutive failures; Verify again is offered from the plan bar.
- The implementer follows the task's `how:` block and departs from it only where the code says it cannot be done that way, noting why under the task.
- The plan view's Tasks tab shows, under each scenario, the task's state and the files it touches; its text, context and `how:` stay in the file. The Spec tab shows which task delivers a rule and which test proves it, or `no task` / `no test`. The stepper stands on Implement with the scenario in progress and `x of y tested` beside it, then on Verify.

Not included: claims across sessions, checkpoints, ADO task updates, per-file-type rules injected at edit time.

# Article series: A coding agent that plans blind

For dev.to. Short, plain, no hype. One mechanism per article, each grounded in what ships.

| # | Working title | Subject | File |
|---|---|---|---|
| 1 | The planner is not allowed to read your code | Blind planning: scope enforced at the tool call, the spec contract, why order matters | [01-plan-blind.md](01-plan-blind.md) |
| 2 | Named rules, and the test that proves each one | Spec contract, tasks that name delivered rules, `proves:` lines, `no task` / `no test` | [02-named-rules.md](02-named-rules.md) |
| 3 | The code is the presumed-wrong party | Mapping the spec against the repo, decisions, rulings, authority order | [03-presumed-wrong.md](03-presumed-wrong.md) |
| 4 | A finish nothing has an opinion about | Mechanical verification and the one-pass cleanup: complexity and file size, no taste | [04-mechanical-finish.md](04-mechanical-finish.md) |
| 5 | One workflow, a different model per step | `CodeSession`, the Claude SDK's JS build and any OpenAI-compatible endpoint, profiles per step | [05-engine-per-step.md](05-engine-per-step.md) |
| 6 | A sandbox instead of forty tool calls | `RunScript`: QuickJS realm, host functions only, staged edits reviewed as one diff | [06-script-sandbox.md](06-script-sandbox.md) |
| 7 | Permissions as a workflow, not a dialog | Read-only classification, shell splitting, project-defined commands, per-phase scope | [07-permissions-as-workflow.md](07-permissions-as-workflow.md) |

Held back, possible part 8: the docs map and the *Evaluate docs* session — how the arrangement of the docs decides how well a feature can be planned.

# Article series: A coding agent that plans blind

For dev.to. Short, plain, no hype. One idea per article, each grounded in what ships, all following one running example: order cancellation, where the code silently refunds nothing over 500.

One trade runs under all of them, and every article should be willing to say it: this workflow spends more tokens and more time than asking a chat for the feature, and in return the features are accurate, they do not contradict each other, and the specs survive the feature and are checked again by every later feature and every session that changes code, so nothing degrades. Slower process, more accurate result.

Files are numbered in publishing order.

| # | Title | Subject | File |
|---|---|---|---|
| 0 | Five things I wanted from a coding agent, so I built one | Overview: the five USPs, who it is for | [00-five-things.md](00-five-things.md) |
| 1 | One feature, from a sentence to green tests | Walkthrough of the running example, step by step | [01-one-feature.md](01-one-feature.md) |
| 2 | A sandbox instead of forty tool calls | `RunScript`: QuickJS realm, gated host functions, staged edits reviewed as one diff | [02-script-sandbox.md](02-script-sandbox.md) |
| 3 | The planner is not allowed to read your code | Blind planning: scope enforced at the tool call, why order matters | [03-plan-blind.md](03-plan-blind.md) |
| 4 | The code is the presumed-wrong party | Checking the approved spec against the repo, decisions, rulings | [04-presumed-wrong.md](04-presumed-wrong.md) |
| 5 | Why my coding agent isn't allowed to grade its own work | Mechanical verification and the one-pass cleanup | [05-grade-own-work.md](05-grade-own-work.md) |
| 6 | Every rule gets a test, or it shows | Named rules, the board derived from the spec, a test named per rule | [06-every-rule-tested.md](06-every-rule-tested.md) |
| 7 | One workflow, a different model per step | Profiles per step, Claude and any OpenAI-compatible endpoint | [07-engine-per-step.md](07-engine-per-step.md) |
| 8 | Permissions as a workflow, not a dialog | Read-only classification, shell parsing, project commands, per-phase scope | [08-permissions-as-workflow.md](08-permissions-as-workflow.md) |

Links between articles point at the GitHub copies; replace each with its dev.to URL once that article is published.

Screenshots: [screenshots.md](screenshots.md).

Held back, possible part 9: the docs map and the *Evaluate docs* session: how the arrangement of the docs decides how well a feature can be planned.

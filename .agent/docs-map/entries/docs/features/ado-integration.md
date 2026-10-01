---
doc: docs/features/ado-integration.md
---
The planned Azure DevOps integration: work items as planning input and spec tasks written back as ADO tasks.

- `#Reading`: the organization/project/PAT settings, the `get_work_item(id)` tool and the fields it includes and excludes, the closure walk with its caps, and the `plan/<feature>.context.md` snapshot the plan session reads instead
- `#Writing`: creating one ADO task per spec task item under the user story, writing task ids back into the spec to avoid duplicates, `drift`-tagged items, task-state updates from implement sessions, and what is out of scope

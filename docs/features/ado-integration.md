# Azure DevOps integration

Work items are the source for planning and the sink for tasks.

## Reading

- Settings: `kiwiAgent.ado.organization`, `kiwiAgent.ado.project`; the PAT is stored through *Set API Key* under the name `ado`.
- Plan session start offers a work item id; its closure is fetched by the extension, not by the model.
- Tool `get_work_item(id)` in plan and reconcile sessions returns markdown: title, description, parent chain, Goal / Actor / Impact / Behaviour / Example fields.
- Excluded: state, comments, tasks, linked PRs, commits, branches, builds, every `System.*` and `Microsoft.VSTS.*` field.
- Walks parents, children and related items with a depth cap and a total cap, detects cycles, orders deterministically.
- The closure is snapshotted to `plan/<feature>.context.md`, and the plan session reads that file instead of calling ADO again.
- Prose that contains file paths or code identifiers is passed through unchanged; the leak is accepted and noted in the snapshot header.

## Writing

- After a spec is approved, "Create tasks" in the plan bar creates one ADO task per spec task item under the user story, titled by the item id and text, linked as child.
- Task ids are written back into the spec next to each item, so re-running updates instead of duplicating.
- After a plan is approved, drift items are created the same way, tagged `drift`.
- Implement sessions set a task to Done through the task-state tool when the item is done, and add the verification output as a comment on failure.

Not included: creating user stories, iteration or area assignment, PR linking.

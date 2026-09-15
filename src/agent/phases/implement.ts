import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import type { SpecState } from './spec-file'
import { tasksDone, tasksFile, type TasksState } from './tasks-file'

/** AskUser is here so a fork the plan does not settle is ruled on by the user instead of blocking the task. */
export const IMPLEMENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Bash', 'Skill', ASK_USER_TOOL]

/** Whose conversation the implement session carries on, if any: the mapping run that wrote the board, or an earlier implementer. */
export type Continued = 'mapping' | 'implement' | undefined

/**
 * The first prompt of an implement session; the system prompt carries the
 * instructions. A session continuing the mapping has the code it read to
 * write the board in context, so it starts on the tasks rather than on the reading.
 */
export function implementKickoff(continued: Continued): string {
  switch (continued) {
    case 'mapping':
      return [
        'The spec you mapped is approved and its findings are ruled; the board you wrote is the work. Read the spec again for the rulings, then implement it task by task.',
        'The files and context you read hold unless a tool result says a file changed; do not read them again to be sure.',
      ].join(' ')
    case 'implement':
      return 'Carry on with the board from where it stands: read the tasks file for the markers, then the next open task.'
    case undefined:
      return 'Implement the spec, task by task.'
  }
}

/**
 * Approval is the human's act; an implementer never starts on anything less,
 * and never starts again on a board whose every task is tested — a fresh
 * session would re-read the code and decide for itself what to redo.
 */
export function assertImplementable(spec: SpecState, tasks: TasksState): void {
  if (!spec.exists) throw new Error('No spec to implement: plan the feature first.')
  if (spec.status !== 'approved') throw new Error('The spec is not approved: rule on the findings and approve it first.')
  if (!tasks.exists) throw new Error('No tasks to implement: map the spec against the code first.')
  if (tasksDone(tasks.tasks)) {
    throw new Error('Every task is tested: plan the next change as its own feature rather than reopening this one.')
  }
}

/**
 * Implement system prompt. The spec is the contract and the tasks file the
 * board: progress is written back into it, so it survives a fresh session.
 */
export function implementPrompt(feature: string, cwd: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const tasks = tasksFile(feature)
  return `You are implementing the feature "${feature}" from its approved spec at \`${spec}\` under ${cwd}, task by task from \`${tasks}\`.

The spec is the contract: goal, behaviour, edge cases, and findings the user has ruled on. A human approved it; do not reinterpret it. Where the code and the spec disagree, the spec wins. Where the spec is silent, do the simplest thing that satisfies it and note the choice in one line under the task.

The tasks file is the board. Each task names the spec items it delivers, the files it touches (\`files:\`) and what was read to arrive at it (\`context:\`): the modules those files lean on, the test that shows the pattern, where the term already lives. The mapping has been done; start a task by reading its files and its context, and search the code only for what they do not answer. Work through the board in order; a task's state is a marker appended to its line, and you move it along as you go:
- \` [in progress]\` when you start it;
- \` [done]\` when the code is written;
- \` [tested]\` when every item the task delivers is proven by a passing test named on the task's \`proves:\` line;
- \` [blocked: reason]\` when you cannot finish it for a reason no answer would remove — a failing build, a missing dependency; then move on.

The \`proves:\` line is the evidence the user reads on the spec: one entry per delivered item, \`<item id> <test file> <test name>\`, comma-separated, the test's name stating the rule it proves:

\`\`\`markdown
- T1 (B1, E1): add the cancel command [tested]
  - files: src/orders/cancel.ts, test/orders/cancel.test.ts
  - proves: B1 test/orders/cancel.test.ts an_open_order_can_be_cancelled, E1 test/orders/cancel.test.ts a_shipped_order_cannot_be_cancelled
\`\`\`

Keep the task's \`files:\` line true to what you touched: add a file you needed that the board did not name. When a decision only the user can make stands in the way — a fork the spec and the board leave open, which of two ways to take — put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer, rather than blocking the task or stopping.

A finding whose ruling says to fix the code is work too; do it with the task it touches.

Rules:
- In the tasks file, only the markers, the files line, the proves line and a one-line note under a task are yours. The spec is not yours to change at all.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Read a file before editing it; read it again when a tool result says it changed underneath you. Do not re-explore what the context line already names.
- A task marked tested is finished: its files are not read unless a later task names them, and a context file read for an earlier task is not read again unless a tool result says it changed.
- Shell commands already run in ${cwd}; do not cd there.
- Tested means the tests for the task's items pass, not that you stopped. When every task is tested or blocked, summarise in a few sentences and stop; the whole test suite is run for you once the board is all tested.`
}

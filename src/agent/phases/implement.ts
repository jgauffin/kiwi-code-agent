import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import type { SpecState } from './spec-file'
import { tasksDone, tasksFile, type TasksState } from './tasks-file'

export const IMPLEMENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Bash', 'Skill']

/** The first prompt of an implement session; the system prompt carries the instructions. */
export const IMPLEMENT_KICKOFF = 'Implement the spec, task by task.'

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

The tasks file is the board. Each task names the spec items it delivers and the files it touches. Work through it in order; a task's state is a marker appended to its line, and you move it along as you go:
- \` [in progress]\` when you start it;
- \` [done]\` when the code is written;
- \` [tested]\` when the tests that prove its items pass;
- \` [blocked: reason]\` when you cannot finish it; then move on.
Keep the task's \`files:\` line true to what you touched: add a file you needed that the board did not name. When nothing more can be done without the user, stop and say what is needed.

A finding whose ruling says to fix the code is work too; do it with the task it touches.

Rules:
- In the tasks file, only the markers, the files line and a one-line note under a task are yours. The spec is not yours to change at all.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Read a file before editing it; read it again when a tool result says it changed underneath you.
- Shell commands already run in ${cwd}; do not cd there.
- Tested means the tests for the task's items pass, not that you stopped. When every task is tested or blocked, summarise in a few sentences and stop; the whole test suite is run for you once the board is all tested.`
}

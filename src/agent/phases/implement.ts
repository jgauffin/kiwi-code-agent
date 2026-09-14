import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import type { SpecState } from './spec-file'

export const IMPLEMENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill']

/** The first prompt of an implement session; the system prompt carries the instructions. */
export const IMPLEMENT_KICKOFF = 'Implement the spec, task by task.'

/** Approval is the human's act; an implementer never starts on anything less. */
export function assertImplementable(state: SpecState): void {
  if (!state.exists) throw new Error('No spec to implement: plan the feature first.')
  if (state.status !== 'approved') throw new Error('The spec is not approved: rule on the findings and approve it first.')
}

/**
 * Implement system prompt. The spec is the contract and also the task board:
 * progress is written back into it, so it survives a fresh session.
 */
export function implementPrompt(feature: string, cwd: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  return `You are implementing the feature "${feature}" from its approved spec at \`${spec}\` under ${cwd}.

The spec is the contract: goal, behaviour, edge cases, tasks, and findings the user has ruled on. A human approved it; do not reinterpret it. Where the code and the spec disagree, the spec wins. Where the spec is silent, do the simplest thing that satisfies it and note the choice in one line under the task.

Work task by task, in order. For each task: read the code it touches before editing, make the change, write or adjust the tests that prove the behaviours it names, run them, and only then mark the task done in the spec by appending \` [done]\` to its line. A task you cannot finish gets \` [blocked: reason]\` and you move on. When nothing more can be done without the user, stop and say what is needed.

A finding whose ruling says to fix the code is work too; do it with the task it touches.

Rules:
- The spec's items are not yours to change: only the task markers and a short note under a task.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Read a file before editing it; read it again when a tool result says it changed underneath you.
- Shell commands already run in ${cwd}; do not cd there.
- Done means the tests for the behaviours pass, not that you stopped. When every task is done or blocked, summarise in a few sentences and stop.`
}

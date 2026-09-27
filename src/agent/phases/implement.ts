import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import type { SpecState } from './spec-file'
import { tasksDone, tasksFile, type TasksState } from './tasks-file'
import type { VerifyRule } from './verification'

/** AskUser is here so a fork the plan does not settle is ruled on by the user instead of blocking the task. */
export const IMPLEMENT_TOOLS = ['Read', 'Write', 'Edit', 'Move', 'Copy', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Bash', 'Skill', ASK_USER_TOOL]

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
        'The spec you mapped is approved and the rulings are applied to it; the board you wrote is the work. Read the spec again for the revised rules, then implement it task by task.',
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
  if (spec.status === 'implemented') throw new Error('The feature is implemented: plan the next change as its own feature.')
  if (spec.status !== 'approved') throw new Error('The spec is not approved: rule on the decisions and approve it first.')
  if (!tasks.exists) throw new Error('No tasks to implement: map the spec against the code first.')
  if (tasksDone(tasks.tasks)) {
    throw new Error('Every task is tested: plan the next change as its own feature rather than reopening this one.')
  }
}

/**
 * Approving the plan is what starts the build, so the implementation begins by
 * itself; `live` says an implementer is already at work, which needs neither a
 * second session nor an offer to start one.
 */
export function implementationStarts(spec: SpecState, tasks: TasksState, live: boolean): boolean {
  return spec.exists && spec.status === 'approved' && tasks.exists && !tasksDone(tasks.tasks) && !live
}

/**
 * The test commands the sweep will run, as the implementer reads them. Naming
 * them is what lets it narrow the same command rather than invent one: a green
 * run of its own then means what a green sweep means.
 */
function verifyCommands(rules: VerifyRule[]): string {
  if (rules.length === 0) return 'No test command is configured for this project, so find the one it uses itself and narrow that.'
  const lines = rules.map((rule) => `- \`${rule.match}\`${rule.project ? ` (project \`${rule.project}\`)` : ''}: \`${rule.command}\``)
  return ['The sweep runs these, over the files the board names:', ...lines].join('\n')
}

/**
 * Implement system prompt. The spec is the contract and the tasks file the
 * board: progress is written back into it, so it survives a fresh session.
 */
export function implementPrompt(feature: string, cwd: string, rules: VerifyRule[] = []): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const tasks = tasksFile(feature)
  return `You are implementing the feature "${feature}" from its approved spec at \`${spec}\` under ${cwd}, task by task from \`${tasks}\`.

The spec is the contract: goal, rules and edge cases. Every rule has a name, the bold lead-in of its line. A human approved it; do not reinterpret it. Where the code and the spec disagree, the spec wins. Where the spec is silent, do the simplest thing that satisfies it and record the choice on the task's \`note:\` line.

The tasks file is the board. Each task names the rules it delivers, the files it touches (\`files:\`), what was read to arrive at it (\`context:\`: the modules those files lean on, the test that shows the pattern, where the term already lives) and what reading would not tell you (\`how:\`: the pattern to follow, a constraint the code imposes, what not to touch). The design within that is yours. The mapping has been done; start a task by reading its files and its context, and search the code only for what they do not answer. Follow the \`how:\` block; depart from it only where the code as you read it says it cannot be done that way, and say so on the task's \`note:\` line. Work through the board in order; a task's state is a marker appended to its line, and you move it along as you go:
- \` [in progress]\` when you start it;
- \` [done]\` when the code is written and the project holding it builds;
- \` [tested]\` when every rule the task delivers is proven by a test named on the task's \`proves:\` line, passing in a run you narrowed to it;
- \` [blocked: reason]\` when you cannot finish it for a reason no answer would remove (a failing build, a missing dependency); then move on.

The \`proves:\` line is the evidence the user reads on the spec: one entry per delivered rule, \`<rule name> → <test file> <test name>\`, comma-separated, the test's name stating the rule it proves:

\`\`\`markdown
- **Cancel command** (Cancel command, Shipped order): add the cancel command [tested]
  - files: src/orders/cancel.ts, test/orders/cancel.test.ts
  - proves: Cancel command → test/orders/cancel.test.ts an_open_order_can_be_cancelled, Shipped order → test/orders/cancel.test.ts a_shipped_order_cannot_be_cancelled
  - note: the guard sits on \`Order\` rather than the handler the \`how:\` named, because a shipped order is refused on every path in.
\`\`\`

Build and test as you go, and narrowly, because you are the one proving the task rather than the run that follows it:
- Build the project the file belongs to, not the repository: \`dotnet build <the .csproj above the file>\`, \`tsc --noEmit -p <the tsconfig above it>\`. The project is the floor; no sound typecheck is narrower than that.
- Run the tests you named on \`proves:\`, filtered to them: \`dotnet test "<project>" --filter FullyQualifiedName~<test>\`, \`npm test -- <test file> -t "<test name>"\`. Never the whole suite while you work: it answers about code that is not yours and costs the same every time you ask.
- ${verifyCommands(rules)}
Narrow those same commands rather than commands of your own, so a green run of yours means what a green sweep means.

Keep the task's \`files:\` line true to what you touched: add a file you needed that the board did not name. When a decision only the user can make stands in the way (a fork the spec and the board leave open, which of two ways to take), put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer, rather than blocking the task or stopping.

Rules:
- In the tasks file, only the markers, the \`files:\` line, the \`proves:\` line and the \`note:\` line under a task are yours; the \`how:\` block is the mapper's. The spec and the decisions file are not yours to change at all.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Read a file before editing it; read it again when a tool result says it changed underneath you. Do not re-explore what the context line already names.
- ${DOC_READING}
- ${CODE_READING} Before writing a test, outline the test file or folder it belongs in: the rule may already be proven, and the neighbouring tests show the pattern to follow.
- A task marked tested is finished: its files are not read unless a later task names them, and a context file read for an earlier task is not read again unless a tool result says it changed.
- Shell commands already run in ${cwd}; do not cd there.
- Tested means you ran the task's tests and they passed, not that you stopped. A task you marked tested without a run of your own is a false marker.
- When every task is tested or blocked, summarise in a few sentences and stop. The full sweep then runs once, to show the feature broke nothing elsewhere; it is not your test run.`
}

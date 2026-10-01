import { DOCS_DIR, SPECS_DIR, SPEC_READING, featureSlug } from './blind-plan'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import { SCRIPT_WRITING } from '../script/script-gate'
import { projectScriptsInstruction } from '../permissions/package-scripts'
import { rulingKind, type Decision } from './decisions'
import { UNFILED_DECISIONS } from './unfiled-decisions'
import type { SpecState } from './spec-file'
import type { Item, Spec } from './spec-model'
import { liveTasks, sameName, tasksDone, type Task, type TaskBoard, type TasksState } from './tasks-file'
import { READ_TASKS_TOOL, UPDATE_TASK_TOOL, detail, marker } from '../openai-session/tools/task-board'
import { verificationHandoffPrompt, type VerificationFailure, type VerifyRule } from './verification'

/** AskUser is here so a fork the plan does not settle is ruled on by the user instead of blocking the task. */
export const IMPLEMENT_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Move', 'Copy', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Bash', 'RunScript', 'Skill', ASK_USER_TOOL,
  READ_TASKS_TOOL, UPDATE_TASK_TOOL,
]

/**
 * Each task is built by a run of its own, started on what the board hands
 * over rather than on a conversation that grew through every task before it:
 * a long run fills its context with finished work, compacts, loses what it
 * read and reads it again. What crosses the boundary is explicit: the task,
 * the rules it delivers, the findings ruled to keep on them, and what earlier
 * tasks built.
 */

/** The task is finished for this run: tested, blocked, or gone from the board. */
export function taskSettled(board: TaskBoard, name: string): boolean {
  const task = board.tasks.find((t) => sameName(t.name, name))
  return task === undefined || task.removed || task.state === 'tested' || task.state === 'blocked'
}

/**
 * The first prompt of a task's run: the task in full, the text of its rules,
 * the findings the user ruled to keep on those rules, and what the tasks
 * before it left.
 */
export function taskKickoff(board: TaskBoard, name: string, spec: Spec, decisions: Decision[] = []): string {
  const task = board.tasks.find((t) => sameName(t.name, name))
  if (!task) throw new Error(`No task named "${name}" on the board.`)
  const rules = rulesOf(spec, task.delivers)
  const lines = ['Your task:', '', detail(task)]
  if (rules.length > 0) lines.push('', 'The rules it delivers, as the spec states them:', ...rules.map((r) => `- **${r.name}**: ${r.text}`))
  const kept = keptFindings(decisions, task.delivers)
  if (kept.length > 0) {
    lines.push('', 'Where the code disagrees with these rules, the user ruled that the spec stands and the code changes:', ...kept.map((d) => `- ${d.title} (on ${d.on.join(', ')}): ${d.finding}`))
  }
  lines.push(...handOff(board, [task]))
  lines.push('', `Do this task only. Move it along with ${UPDATE_TASK_TOOL}, and stop when it is tested or blocked.`)
  return lines.join('\n')
}

/** A task run that stopped before its task was settled picks it up again. */
export const TASK_CARRY_ON = `Carry on with your task from where you stopped: ${READ_TASKS_TOOL} with its name shows where it stands. It is unfinished until tested or blocked: if nothing within this task can prove what is left, block it with that as the reason.`

/**
 * The failed sweep for a run of its own: the output, the tasks whose files or
 * tests the output names in full, and what every task built, so the fix
 * starts from the work the failure is about rather than from the last task.
 */
export function fixKickoff(feature: string, board: TaskBoard, failures: VerificationFailure[], cwd: string): string {
  const output = failures.map((f) => f.output.split('\\').join('/')).join('\n')
  const named = liveTasks(board.tasks).filter((t) => [...t.files, ...t.proves.map((p) => p.file)].some((file) => output.includes(file)))
  const lines = [verificationHandoffPrompt(feature, failures, cwd)]
  if (named.length > 0) lines.push('', 'The tasks the failure names:', ...named.flatMap((t) => ['', detail(t)]))
  lines.push(...handOff(board, named))
  return lines.join('\n')
}

/**
 * The next failed sweep for the fix run that has seen this feature's failures:
 * it holds the tasks already, so it gets the output and what tells a flaky
 * failure from a broken one, not everything it already read.
 */
export function fixRetry(feature: string, failures: VerificationFailure[], cwd: string): string {
  return [
    'The test run failed again.',
    '',
    verificationHandoffPrompt(feature, failures, cwd),
    '',
    'Compare this output with the failure you fixed before. A test that fails where it passed in your own narrowed run, or fails differently from one run to the next, points at another session changing the same tree or at the test itself: rerun it before changing code that already passed.',
  ].join('\n')
}

/** One line per task some run has worked on, besides the ones shown in full. */
function handOff(board: TaskBoard, shown: Task[]): string[] {
  const worked = liveTasks(board.tasks).filter((t) => t.state !== 'open' && t.state !== 'in_progress' && !shown.includes(t))
  if (worked.length === 0) return []
  const line = (t: Task) =>
    `- ${t.name} [${marker(t)}]${t.built.trim() ? `: ${t.built.trim()}` : ''}${t.files.length > 0 ? ` (files: ${t.files.join(', ')})` : ''}`
  return ['', 'What earlier tasks left:', ...worked.map(line)]
}

/** Applied `keep` rulings on a rule the task delivers: work for this task that the spec does not spell out, since the spec already said it. */
function keptFindings(decisions: Decision[], delivers: string[]): Decision[] {
  return decisions.filter((d) => d.state === 'applied' && rulingKind(d) === 'keep' && d.on.some((rule) => delivers.some((name) => sameName(name, rule))))
}

/** The spec's live rules and edge cases by name, in the order the task names them. */
function rulesOf(spec: Spec, names: string[]): Item[] {
  const items = spec.scenarios.flatMap((s) => s.behaviours.flatMap((b) => [b, ...b.edges])).filter((i) => !i.removed)
  return names.flatMap((name) => items.filter((i) => sameName(i.name, name)))
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
  if (!tasks.exists) throw new Error('No tasks to implement yet: the board is derived once the spec is checked against the code.')
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
 * Implement system prompt, the same for every task run of a feature: the task
 * itself rides in the first message, so each run after the first starts on a
 * prefix the engine has cached.
 */
export function implementPrompt(feature: string, cwd: string, rules: VerifyRule[] = []): string {
  const spec = `${SPECS_DIR}/${featureSlug(feature)}.spec.md`
  const scripts = projectScriptsInstruction(cwd)
  return `You are implementing one task of the feature "${feature}", from its approved spec at \`${spec}\` under ${cwd}. The first message hands you the task in full from the board, the text of the spec rules it delivers, any finding in the code the user ruled to change so the spec stands, and what earlier tasks left: what each one built, by name and file. Earlier tasks were built by runs of their own and later ones will be; this run does its one task and stops. A run started on a failed test sweep has the failure as its task instead, and the tasks it names.

The spec is the contract: goal, rules and edge cases. Every rule has a name, the bold lead-in of its line. A human approved it; do not reinterpret it. Where the code and the spec disagree, the spec wins. Where the spec is silent, do the simplest thing that satisfies it and record the choice in the task's note.

The board is read with ${READ_TASKS_TOOL} and moved along with ${UPDATE_TASK_TOOL}; it is not a file you read or edit. Your task is one scenario of the spec and names the rules it delivers; its context, when it has one, is where the check of the spec found that scenario is built, and the rest of where and how is yours to find in the code. Read in batches, several Reads in one message: every request carries the whole conversation, so a batch costs one request where reading one file at a time costs one each. Build on what earlier tasks left rather than finding it again; open another task's files only where your task needs them. A task that already names files, context or a how: start from those and search only for what they do not answer, and depart from the how only where the code says it cannot be done that way, saying so in the task's note.

Your task is already in_progress. Record where it ends with ${UPDATE_TASK_TOOL}:
- tested when every rule the task delivers is proven by a test named in its proves, passing in a run you narrowed to it. In the same call give the proves and built: what this task left that a later task builds on (the types, functions, tables and test helpers it added or changed, by name and file). The next task starts from those lines, not from your conversation;
- blocked, with the reason, when you cannot finish it for a reason no answer would remove (a failing build, a missing dependency), or when the user's answer puts a rule's proof out of this task's reach (its tests come with a framework added later). The next task starts on the board's next one;
- done only if you must stop before the tests pass: the code is written and the project holding it builds. Done is not where a task rests: the run is sent back to it until it is tested or blocked.

The proves are the evidence the user reads on the spec: one entry per delivered rule, the test's name stating the rule it proves.

Build and test as you go, and narrowly, because you are the one proving the task rather than the run that follows it:
- Build the project the file belongs to, not the repository: \`dotnet build <the .csproj above the file>\`, \`tsc --noEmit -p <the tsconfig above it>\`. The project is the floor; no sound typecheck is narrower than that.
- Run the tests you named on \`proves:\`, filtered to them: \`dotnet test "<project>" --filter FullyQualifiedName~<test>\`, \`npm test -- <test file> -t "<test name>"\`. Never the whole suite while you work: it answers about code that is not yours and costs the same every time you ask.
- ${verifyCommands(rules)}
Narrow those same commands rather than commands of your own, so a green run of yours means what a green sweep means.

Name every file you touched on the task's files, its tests included: the sweep runs over them, and tested is refused on a task that names none. When a decision only the user can make stands in the way (a fork the spec and the code leave open, which of two ways to take), put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer, rather than blocking the task or stopping.

The next feature is planned blind from the docs and specs, so an answer that settles what the product does is recorded where that planner reads. An answer on a rule the task delivers amends the spec: the rule's text, or an edge case or a rule added in the task's scenario, in the spec's own shape and language, with every name kept. Prove it like any delivered rule. An answer that reaches beyond your task is recorded as unfiled: ${UNFILED_DECISIONS}

Rules:
- The decisions file is not yours to change, and the spec only as above.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Other features' specs bind you as your own does. ${SPEC_READING}
- Do not re-explore what the hand-off already names.
- Code and comments never refer to the spec, its rule names or the task: those move on and the reference goes stale. Where a business rule is not obvious from the code, explain it in a short comment in the domain's own words.
- ${DOC_READING}
- ${CODE_READING} Before writing a test, outline the test file or folder it belongs in: the rule may already be proven, and the neighbouring tests show the pattern to follow.
- ${EDIT_WRITING}
- ${SCRIPT_WRITING}${scripts ? `\n- ${scripts}` : ''}
- Shell commands already run in ${cwd}; do not cd there.
- Tested means you ran the task's tests and they passed, not that you stopped. A task you marked tested without a run of your own is a false record.
- When your task is tested or blocked, say in a sentence or two what you did and stop. The next task starts in a run of its own, and the full sweep runs once every task is tested; it is not your test run.`
}

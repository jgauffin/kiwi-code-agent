import { DOCS_DIR, SPECS_DIR, featureSlug } from './blind-plan'
import { ASK_USER_TOOL } from '../openai-session/tools/ask-user'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { EDIT_WRITING } from '../openai-session/tools/edit'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import { SCRIPT_WRITING } from '../script/script-gate'
import { projectScriptsInstruction } from '../permissions/package-scripts'
import { rulingKind, type Decision } from './decisions'
import { UNFILED_DECISIONS } from './unfiled-decisions'
import { SPEC_SEARCH_TOOL } from './spec-search'
import type { SpecState } from './spec-file'
import { isSettled, isVerified } from './spec-status'
import type { Item, Spec } from './spec-model'
import { liveTasks, sameName, tasksDone, type Task, type TaskBoard, type TasksState } from './tasks-file'
import { READ_TASKS_TOOL, UPDATE_TASK_TOOL, detail, marker } from '../openai-session/tools/task-board'
import { verificationHandoffPrompt, type VerificationFailure, type VerifyRule } from './verification'

/** AskUser is here so a fork the plan does not settle is ruled on by the user instead of blocking the task. */
export const IMPLEMENT_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Move', 'Copy', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, SPEC_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Bash', 'RunScript', 'Skill', ASK_USER_TOOL,
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

/** A blocked task the person hands back: what stood in its way may have changed since it was blocked. */
export const taskRetry = (reason: string): string =>
  `Your task was blocked: ${reason}\n\nThe user hands it back to you: what stood in the way may have changed since. Look again before you block it on the same reason. ${READ_TASKS_TOOL} with its name shows where it stands. It is unfinished until tested or blocked: if nothing within this task can prove what is left, block it with that as the reason.`

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
  if (isVerified(spec.status)) throw new Error('The feature is verified: plan the next change as its own feature.')
  if (!isSettled(spec.status)) throw new Error('The spec is not approved: rule on the decisions and approve it first.')
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
  const lines = rules.map((rule) => `${filesOf(rule)}: \`${rule.command}\``)
  return ['The sweep runs these, over the files the board names; each runs without a prompt:', ...lines, ...placeholders(rules)].join('\n')
}

/**
 * Step three, with the build command of each rule that has one. The command is
 * per project by construction, so the build covers the file's project and not
 * the repository, and it runs without a prompt like the test commands.
 */
function buildStep(rules: VerifyRule[]): string {
  const builds = rules.filter((rule) => rule.build?.trim())
  if (builds.length === 0) return 'Build the project the file belongs to, not the repository.'
  return ['Build the project the file belongs to, not the repository, with the command for its files; it runs without a prompt:', ...builds.map((rule) => `${filesOf(rule)}: \`${rule.build}\``)].join('\n')
}

const filesOf = (rule: VerifyRule): string => `- \`${rule.match}\`${rule.project ? ` (project \`${rule.project}\`)` : ''}`

/** What the placeholders stand for, said once, when a command carries one. */
function placeholders(rules: VerifyRule[]): string[] {
  const templates = rules.flatMap((rule) => [rule.command, rule.build ?? ''])
  return templates.some((t) => t.includes('{')) ? ['`{project}` is the nearest file matching the project glob above the file, `{projectDir}` its folder, `{file}` the file itself.'] : []
}

/**
 * Implement system prompt, the same for every task run of a feature: the task
 * itself rides in the first message, so each run after the first starts on a
 * prefix the engine has cached.
 */
export function implementPrompt(feature: string, cwd: string, rules: VerifyRule[] = []): string {
  const spec = `${SPECS_DIR}/${featureSlug(feature)}.spec.md`
  const scripts = projectScriptsInstruction(cwd)
  return `You are implementing one task of the feature "${feature}", from its approved spec at \`${spec}\` under ${cwd}.

Terms:
- The spec is the contract. A human approved it, so do not reinterpret it: where the code and the spec disagree the spec wins, and where the spec is silent do the simplest thing that satisfies it and record the choice in the task's note.
- The task board holds the feature's tasks. Read it with ${READ_TASKS_TOOL}, change it with ${UPDATE_TASK_TOOL}; it is not a file you read or edit.
- A task is one scenario of the spec and names the rules it delivers. Its context, when it has one, is where the check of the spec found that scenario built; the rest of where and how is yours to find in the code.
- The sweep is the full test run that follows once every task is tested. It is not your test run.

Each task is built by a run of its own: this run does its one task and stops. A run started on a failed sweep has that failure as its task instead, plus the tasks it names.

The first message gives you the task in full, the text of the rules it delivers, any finding in the code the user ruled to change so the spec stands, and what earlier tasks left: what each one built, by name and file.

How the run goes:

1. Start. Your task is already in_progress; a run started on a failed sweep moves the tasks the failure touches there itself.
2. Implement. Where the task carries a \`how\`, build it that way: depart from the how only where the code shows it cannot be done that way, saying so in the task's note. The task's \`files\` are the surface the plan derived and its \`context\` is where the scenario was found built: when it has them, open those and work from them, rather than deriving the surface again. Open them in one go, several Reads in one message: each request re-sends the whole conversation. Search only for what they leave open, and open another task's files only where yours needs them. A task with neither finds its surface with ${CODE_SEARCH_TOOL} and ${CODE_OUTLINE_TOOL}.
3. ${buildStep(rules)}
4. Test. Run the tests you named on \`proves:\`, filtered to them. Never the whole suite while you work: it answers about code that is not yours. ${verifyCommands(rules)}
Narrow those same commands rather than commands of your own, so a passing run of yours means what a passing sweep means.
5. Record the end with ${UPDATE_TASK_TOOL}, and name on files every file you touched, tests included: the sweep runs over them, and tested is refused on a task that names none.
- tested when every rule the task delivers is proven by a test named in its proves, passing in a run you narrowed to it. Give proves and built in the same call. Proves is one entry per delivered rule, the test's name stating the rule it proves; built is what a later task builds on, the types, functions, tables and test helpers you added or changed, by name and file. The next task starts from those lines, not from your conversation.
- blocked, with the reason, when you cannot finish for a reason no answer would remove (a failing build, a missing dependency), or when the user's answer puts a rule's proof out of this task's reach (its tests come with a framework added later).
- done only when you must stop before the tests pass: the code is written and the project holding it builds. The run is sent back to the task until it is tested or blocked.
6. Stop, with a sentence or two on what you did.

When a decision only the user can make stands in the way (a fork the spec and the code leave open, which of two ways to take), put it with the \`${ASK_USER_TOOL}\` tool and carry on with the answer, rather than blocking the task or stopping. The next feature is planned blind from the docs and specs, so an answer that settles what the product does is recorded where that planner reads. An answer on a rule the task delivers amends the spec: the rule's text, or an edge case or a rule added in the task's scenario, in the spec's own shape and language, with every name kept. Prove it like any delivered rule. An answer that reaches beyond your task is recorded as unfiled: ${UNFILED_DECISIONS}

Rules:
- The decisions file is not yours to change, and the spec only as above.
- Never edit \`${DOCS_DIR}/\`: intent is the user's.
- Other features' approved specs bind you as your own does, and your own rules are already in your first message: where your change touches a behaviour another feature covers, find its rules with ${SPEC_SEARCH_TOOL}, which returns them whole. Breaking one of its rules is the user's call: ask first, and once they agree, amend that rule in its spec.
- Code and comments never refer to the spec, its rule names or the task: those move on and the reference goes stale. Where a business rule is not obvious from the code, explain it in a short comment in the domain's own words.
- ${CODE_READING} Before writing a test, outline the test file or folder it belongs in: the rule may already be proven, and the neighbouring tests show the pattern to follow.
- ${EDIT_WRITING}
- ${SCRIPT_WRITING}${scripts ? `\n- ${scripts}` : ''}
- A task marked tested without a run of your own is a false record.`
}

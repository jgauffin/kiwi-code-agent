import { DOCS_DIR, PLAN_DIR, SPECS_GLOB, featureSlug } from './blind-plan'
import { KEEP_RULING, decisionsFile } from './decisions'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import type { Scope } from './scope-guard'
import { tasksFile } from './tasks-file'
import { MAP_ROOT } from '../repo-map/map-files'
import type { SessionEvent } from '../session/code-session'

/** The mapping run sees everything and may change nothing but its own two outputs; the spec is the planner's and the user's. */
export function reconcileScope(feature: string): Scope {
  return {
    // `**` does not match a dot-prefixed segment, so the map's root is named:
    // the run is given the type indexes the summary points it at.
    readable: ['**', `${MAP_ROOT}/**`],
    writable: [decisionsFile(feature), tasksFile(feature)],
  }
}

export const RECONCILE_TOOLS = ['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Edit', 'Write', 'Skill']

/**
 * The first prompt of a mapping run; the system prompt carries the
 * instructions. A run that continues the last mapping's conversation has the
 * code it read and the spec it mapped in context, so it re-reads the spec and
 * touches only what the change reaches. A note is guidance for the mapping
 * itself — a level of detail, a scope, a house style — not a spec change.
 */
export function reconcileKickoff(continued: boolean, note?: string): string {
  const base = !continued
    ? 'Map the spec against the code: write the decisions, then the tasks.'
    : [
        'The spec changed since you mapped it. Read it again and map the change: update the decisions and the tasks it touches, leave the rest as they are, and write what is still missing.',
        'What you read of the code holds unless a tool result says a file changed; do not read it again to be sure.',
      ].join(' ')
  return note ? `${base}\n\nAlso: ${note}` : base
}

/**
 * Reconcile system prompt. The job is to find what stands in the feature's
 * way, not to grade the spec: silence on an item means the code accommodates it.
 * The spec is the intent for this feature; the docs it came from are not re-read.
 */
export function reconcilePrompt(feature: string, cwd: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const decisions = decisionsFile(feature)
  const tasks = tasksFile(feature)
  return `You are mapping the spec for the feature "${feature}" against the source code it will be built in.

The spec at \`${spec}\` under ${cwd} was written blind, from product intent alone, so that the code's mistakes would not become requirements. Your job is the other half, in two parts: find what in the code stands in the feature's way before implementation starts, then say what to do and where. You are not grading the spec. A rule the code accommodates without incident is not mentioned. An empty list of decisions is a valid result.

Read the spec first. Every rule has a name, the bold lead-in of its line; that name is how you refer to it everywhere. Then search the code for what the spec touches: the rules it changes, the behaviour it adds to, the places its terms already live. ${CODE_READING}

The spec is the intent for this feature; it was distilled from \`${DOCS_DIR}/**\` and the other features' specs under \`${SPECS_GLOB}\` by a session that read all of them, so do not browse those. A rule may end with a citation of the section it came from, as \`(${DOCS_DIR}/intent/orders.md#Cancellation)\`; open that section only to quote it in a contradiction. ${DOC_READING} A rule without a citation is the planner's own default, the weaker side in a contradiction.

What you look for, each of them a decision the user has to make: a business rule in the code that says otherwise (the human decides which side is right; you present both); existing behaviour the feature would change or break that the spec does not mention; something the spec assumes that the code shows to be wrong.

Only in code the tasks will change or build on. Behaviour in code the feature leaves alone is not a finding, even where it disagrees with the spec. When where the feature is built is itself open (the behaviour already lives in code the feature may replace rather than change), that is one decision, and the findings in that code wait for its ruling. A constraint that changes how a rule is built but not what it does is not a decision: it goes in the task's \`how:\`.

Authority order, when sources disagree: the docs and the approved specs, then the code. The code is the presumed-wrong party, but it is also where the users' current reality lives, so a contradiction is reported, not resolved.

Your first output: the decisions file, \`${decisions}\`, one \`###\` per decision. Structure:

\`\`\`markdown
# Decisions for ${feature}

### Shipped orders cannot be cancelled
- on: Cancel command, Shipped order
- finding: \`Order.cancel\` in src/orders/order.ts refuses a shipped order outright, so neither rule can hold as written.

### The daily report counts cancelled orders
- on: Cancel command
- finding: \`dailyReport\` in src/reports/daily.ts counts every order whatever its state, and the rule is silent on what a cancelled one does to the report.
\`\`\`

Rules:
- The title names the disagreement. The finding is one or two sentences, as in the example: what the code does today, at the one path and symbol that shows it, and how that stands against the rules in \`on\`: it contradicts them, or they are silent on it. Do not quote or restate a rule; the user reads it verbatim beside your finding. Not how you found it, not what the spec should say instead, not the task: the planner's proposals and the board carry those.
- \`on\` names the rules the decision concerns, as they are named in the spec.
- The \`proposed\`, \`recommended\` and \`because\` lines are the planner's and the \`ruling\` line is the user's: never write, change or remove any of them.
- Titles are stable. On a re-run, keep a decision that still holds, append \` [withdrawn]\` to the heading of one that no longer applies, and add new ones. A decision marked \` [applied]\` is settled: one ruled \`${KEEP_RULING}\` means the spec stands and the code changes, which is work for the task that touches it, so its \`how:\` says so; do not report it again.
- Do not paste code.
- The spec is not yours to write: its rules are the planner's and the user's.

Your second output: the task board, \`${tasks}\`, written with Write. Start from one task per scenario of the spec, in build order, under a \`##\` heading with that scenario's title, each task naming the rules it delivers and the files it touches. Structure:

\`\`\`markdown
# Tasks for ${feature}

## Cancelling an order
- **Cancel command** (Cancel command, Shipped order, Refund): the scenario, as work: what to do, in one line
  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)
  - context: src/orders/order.ts, src/orders/ship.test.ts
  - how:
    - follow src/orders/ship.ts and its test: the guard sits on \`Order\`, the handler only parses, loads, calls and saves
    - leave \`OrderStatus\` alone: the reports switch on it

## Releasing the reservation
- **Reservation release** (Release on cancel): ...
  - files: src/orders/reservation.ts
  - context: src/orders/order.ts, src/billing/invoice.ts
  - how:
    - ...
\`\`\`

Rules:
- One task per scenario is the default; depart from it only for a reason you name in the task text: a scenario too big to build and test in one sitting is split in build order under the same heading (a group of rules is not a reason to split), a foundation every scenario needs (a contract module, a schema) is one task under a \`## Foundation\` heading first in the file, delivering the rules it serves.
- Every rule and edge case of the spec is delivered by some task. A rule no task delivers is a gap the user sees.
- The task's own line is one sentence, for the person: what the task does, no more. The detail goes in \`how:\`.
- The files are workspace-relative paths that exist, or paths to create marked \`(new)\`, placed where the code around them says such a file belongs. The tests that prove a task's rules are files of that task.
- The context is what you read to arrive at the task and the implementer would otherwise have to find again: the modules the task's files lean on, the test that shows the pattern to follow, the place the term already lives. Existing paths only, the few that matter; a task starts from its files and its context and searches beyond them only when those do not answer.
- The \`how:\` block holds what the implementer would not learn from reading its files and context: the existing code that shows the pattern to follow, a constraint the code imposes that those files do not show, what not to touch. Not the steps, signatures, fields or columns: the implementer reads the same code and designs them. A few lines. No code pasted.
- A task's name is the bold lead-in of its line, a few words, unique in the file and stable across re-runs: keep a task that still holds and update its text, files, context and how, append \` [removed]\` to one that no longer applies, add new ones. Never touch a marker, a \`proves:\` line or a \`note:\` line the implementer left on a task (\`[in progress]\`, \`[done]\`, \`[tested]\`, \`[blocked: ...]\`): a note says where the build departed from the \`how:\` it was given and why, so it survives a rewrite of the task and goes only when the task does.
- No task for what a pending decision puts in question: the user rules first.
- The file's front matter and a \`## Verification\` section at its end are the extension's; leave them alone.
- When both files are written, stop. Say nothing more: decisions and tasks are read from the files.`
}

/** What a run under a session is doing right now, as the plan bar shows it; undefined when the event says nothing worth showing. */
export function progressLine(event: SessionEvent, label = 'Check'): string | undefined {
  switch (event.type) {
    case 'tool_call':
      return toolLine(event.name, event.input)
    case 'assistant_message': {
      const first = event.text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim()
      return first ? clip(first) : undefined
    }
    case 'error':
      return `${label} failed: ${clip(event.message)}`
    default:
      return undefined
  }
}

function toolLine(name: string, raw: unknown): string {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const text = (key: string): string | undefined => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return clip(`${name} ${text('file_path') ?? ''}`)
    case 'Grep':
      return clip(`Grep "${text('pattern') ?? ''}" in ${text('path') ?? '.'}`)
    case 'Glob':
      return clip(`Glob ${text('pattern') ?? ''} in ${text('path') ?? '.'}`)
    case 'CodeOutline':
      return clip(`CodeOutline ${text('symbol') ? `${text('symbol')} in ` : ''}${text('path') ?? ''}`)
    case 'CodeSearch':
      return clip(`CodeSearch "${text('query') ?? ''}" in ${text('path') ?? '.'}`)
    case 'Skill':
      return clip(`Skill ${text('name') ?? text('skill') ?? ''}`)
    default:
      return name
  }
}

function clip(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

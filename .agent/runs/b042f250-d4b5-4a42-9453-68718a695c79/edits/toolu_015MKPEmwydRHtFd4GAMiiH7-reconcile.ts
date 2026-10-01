import { DOCS_DIR, PLAN_DIR, SPECS_GLOB, featureSlug } from './blind-plan'
import { KEEP_RULING, decisionsFile } from './decisions'
import { contextFile } from './scenario-context'
import { MARKDOWN_SEARCH_TOOL } from '../openai-session/tools/markdown-search'
import { DOC_READING } from '../openai-session/tools/markdown/outline-gate'
import { CODE_OUTLINE_TOOL } from '../code-outline/code-outline-tool'
import { CODE_READING } from '../code-outline/code-outline-gate'
import { CODE_SEARCH_TOOL } from '../code-outline/code-search'
import type { Scope } from './scope-guard'
import { READ_TASKS_TOOL, UPDATE_TASK_TOOL } from '../openai-session/tools/task-board'
import { MAP_ROOT } from '../repo-map/map-files'
import type { SessionEvent } from '../session/code-session'

/** The check sees everything and may change nothing but its decisions file; the spec is the planner's and the user's. */
export function reconcileScope(feature: string): Scope {
  return {
    // `**` does not match a dot-prefixed segment, so the map's root is named:
    // the run is given the type indexes the summary points it at.
    readable: ['**', `${MAP_ROOT}/**`],
    writable: [decisionsFile(feature), contextFile(feature)],
  }
}

export const RECONCILE_TOOLS = ['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', MARKDOWN_SEARCH_TOOL, CODE_OUTLINE_TOOL, CODE_SEARCH_TOOL, 'Edit', 'Write', 'Skill']

/**
 * The first prompt of a check; the system prompt carries the instructions. A
 * run that continues the last check's conversation has the code it read and
 * the spec it checked in context, so it re-reads the spec and touches only
 * what the change reaches.
 */
export function reconcileKickoff(continued: boolean): string {
  return !continued
    ? 'Check the spec against the code and write the decisions.'
    : [
        'The spec changed since you checked it. Read it again and check the change: update the decisions and the context entries it touches, leave the rest as they are, and write what is new.',
        'What you read of the code holds unless a tool result says a file changed; do not read it again to be sure.',
      ].join(' ')
}

/**
 * Check system prompt. The job is to find what stands in the feature's way,
 * not to grade the spec: silence on an item means the code accommodates it.
 * The spec is the intent for this feature; the docs it came from are not re-read.
 */
export function reconcilePrompt(feature: string, cwd: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const decisions = decisionsFile(feature)
  const context = contextFile(feature)
  return `You are checking the approved spec for the feature "${feature}" against the source code it will be built in.

The spec at \`${spec}\` under ${cwd} was written blind, from product intent alone, so that the code's mistakes would not become requirements. Your job is the other half: find what in the code stands in the feature's way before any of it is built, so the user rules on it now rather than after half the work is done. You are not grading the spec. A rule the code accommodates without incident is not mentioned. An empty list of decisions is a valid result: the build then starts without the user being asked anything.

Read the spec first. Every rule has a name, the bold lead-in of its line; that name is how you refer to it everywhere. Then search the code for what the spec touches: the rules it changes, the behaviour it adds to, the places its terms already live. ${CODE_READING}

The spec is the intent for this feature; it was distilled from \`${DOCS_DIR}/**\` and the other features' specs under \`${SPECS_GLOB}\` by a session that read all of them, so do not browse those. A rule may end with a citation of the section it came from, as \`(${DOCS_DIR}/intent/orders.md#Cancellation)\`; open that section only to quote it in a contradiction. ${DOC_READING} A rule without a citation is the planner's own default, the weaker side in a contradiction.

What you look for, each of them a decision the user has to make: a business rule in the code that says otherwise (the human decides which side is right; you present both); existing behaviour the feature would change or break that the spec does not mention; something the spec assumes that the code shows to be wrong.

Only in code the feature will change or build on. Behaviour in code the feature leaves alone is not a finding, even where it disagrees with the spec. When where the feature is built is itself open (the behaviour already lives in code the feature may replace rather than change), that is one decision, and the findings in that code wait for its ruling. A constraint that changes how a rule is built but not what it does is not a decision: the implementer reads the same code.

Authority order, when sources disagree: the docs and the approved specs, then the code. The code is the presumed-wrong party, but it is also where the users' current reality lives, so a contradiction is reported, not resolved.

Your output: the decisions file, \`${decisions}\`, one \`###\` per decision. Structure:

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
- The title names the disagreement. The finding is one or two sentences, as in the example: what the code does today, at the one path and symbol that shows it, and how that stands against the rules in \`on\`: it contradicts them, or they are silent on it. Do not quote or restate a rule; the user reads it verbatim beside your finding. Not how you found it, not what the spec should say instead, not how to build it: the planner's proposals and the implementer carry those.
- \`on\` names the rules the decision concerns, as they are named in the spec.
- The \`proposed\`, \`recommended\` and \`because\` lines are the planner's and the \`ruling\` line is the user's: never write, change or remove any of them.
- Titles are stable. On a re-run, keep a decision that still holds, append \` [withdrawn]\` to the heading of one that no longer applies, and add new ones. A decision marked \` [applied]\` is settled: one ruled \`${KEEP_RULING}\` means the spec stands and the code changes, and its finding reaches the implementer as it is; do not report it again.
- Do not paste code.
- The spec is not yours to write: its rules are the planner's and the user's.
- With no decision to report, write no file.

Also, every run, the context file \`${context}\`: under each scenario of the spec, the files its work will change or build on, as you found them while checking, most important first. Each scenario becomes a task whose implementer starts from these files instead of searching the code again. A scenario that builds something new names where it goes and what it builds on.

\`\`\`markdown
# Where ${feature} is built

## Cancelling an order
- src/orders/order.ts
- src/orders/order-service.ts
\`\`\`

When the context and the decisions are written, or there are no decisions, stop. Say nothing more: both are read from where you wrote them.`
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
    case UPDATE_TASK_TOOL:
      return clip(`${text('task') ?? ''}${text('state') ? `: ${text('state')!.replace('_', ' ')}` : ''}`)
    case READ_TASKS_TOOL:
      return 'Reading the tasks'
    default:
      return name
  }
}

function clip(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

import { DOCS_DIR, PLAN_DIR, featureSlug } from './blind-plan'
import type { Scope } from './scope-guard'
import { tasksFile } from './tasks-file'
import type { SessionEvent } from '../session/code-session'

/** The mapping run sees everything and may change nothing but the spec, its tasks and its intent amendments. */
export function reconcileScope(feature: string): Scope {
  const slug = featureSlug(feature)
  return {
    readable: ['**'],
    writable: [`${PLAN_DIR}/${slug}.spec.md`, tasksFile(feature), `${PLAN_DIR}/${slug}.intent.md`],
  }
}

export const RECONCILE_TOOLS = ['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Edit', 'Write', 'Skill']

/** The first prompt of a mapping run; the system prompt carries the instructions. */
export const RECONCILE_KICKOFF = 'Map the spec against the code: write your findings, then the tasks.'

export const FINDINGS_SECTION = 'Findings'

/** One row of the Findings table. `proposal` is empty until the planner has filled the cell. */
export type Finding = { id: string; text: string; proposal: string; resolved: boolean }

const HEADING = /^#{1,6}\s+(.*)$/
const FINDING_ROW = /^\|\s*(F\d+)\b([^|]*)\|([^|]*)\|/
const SETTLED = /\[(resolved|removed)\]/i

export function findings(body: string): Finding[] {
  const rows: Finding[] = []
  let inSection = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = HEADING.exec(line)
    if (heading) {
      inSection = heading[1]!.trim() === FINDINGS_SECTION
      continue
    }
    const row = inSection ? FINDING_ROW.exec(line) : null
    if (!row) continue
    const text = row[2]!.trim().replace(/^:\s*/, '')
    rows.push({ id: row[1]!, text, proposal: row[3]!.trim(), resolved: SETTLED.test(row[2]!) })
  }
  return rows
}

/** Findings the user has yet to rule on. */
export const openFindings = (body: string): Finding[] => findings(body).filter((f) => !f.resolved)

/**
 * Reconcile system prompt. The job is to find what stands in the feature's
 * way, not to grade the spec: silence on an item means the code accommodates it.
 * The spec is the intent for this feature; the docs it came from are not re-read.
 */
export function reconcilePrompt(feature: string, cwd: string): string {
  const spec = `${PLAN_DIR}/${featureSlug(feature)}.spec.md`
  const tasks = tasksFile(feature)
  return `You are mapping the spec for the feature "${feature}" against the source code it will be built in.

The spec at \`${spec}\` under ${cwd} was written blind, from product intent alone, so that the code's mistakes would not become requirements. Your job is the other half, in two parts: find what in the code stands in the feature's way before implementation starts, then say what to do and where. You are not grading the spec. A spec item the code accommodates without incident is not mentioned. An empty findings list is a valid result.

Read the spec first. Then search the code for what the spec touches: the rules it changes, the behaviour it adds to, the places its terms already live.

The spec is the intent for this feature; it was distilled from \`${DOCS_DIR}/**\` by a session that read all of it, so do not browse those docs. An item may cite the section it came from, as \`B2 (${DOCS_DIR}/intent/orders.md#Cancellation)\`; open that section only to quote it in a contradiction. An item without a citation is the planner's own default, the weaker side in a contradiction.

A finding is one of:
- contradiction: a business rule in the code says otherwise. The human decides which side is right; you present both.
- breakage: existing behaviour the feature would change or break that the spec does not mention.
- naive: the spec assumes something the code shows to be wrong. Say what is wrong and what the spec should say instead.

Authority order, when sources disagree: the intent docs, then the code. The code is the presumed-wrong party, but it is also where the users' current reality lives, so a contradiction is reported, not resolved.

A \`naive\` finding says intent is out of date as much as the spec is: what the code shows is true and intent does not say it. Record that as an amendment in \`${PLAN_DIR}/${featureSlug(feature)}.intent.md\`, alongside the finding, so the next feature planned from intent does not repeat the same wrong assumption. You never edit \`${DOCS_DIR}/\` yourself: intent is the user's, and the user applies these.

\`\`\`markdown
## A1 (append) ${DOCS_DIR}/intent/orders.md#Cancellation
- from: F3 (naive)
- why: intent does not say that a cancelled order keeps its invoice.

A cancelled order keeps its invoice; the invoice is credited rather than withdrawn.
\`\`\`

The mode is \`append\`, \`replace\` or \`new\`. Write it as intent reads: the product's language, present tense, no code, no reference to this spec or its ids. Amendment ids are stable and never reused; leave an applied one alone.

Your first output: a \`## ${FINDINGS_SECTION}\` section at the end of the spec, a table, and nothing else in the file changes. Structure:

\`\`\`markdown
## ${FINDINGS_SECTION}
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B3): what the code does, where (path and symbol), and what the spec says. | |
| F2 (breakage, B2): what changes for existing behaviour, where. | |
| F3 (naive, E1): what the spec assumes, what the code shows, what the spec should say. | |
\`\`\`

Rules:
- Short. Each finding is a few lines, every one something the user has to rule on. Do not list what you checked.
- The Proposed solution column is the planner's: leave it empty on a new finding and leave a filled one alone.
- Finding ids are stable: never renumber, only add. On a re-run, keep findings that still hold, append \` [resolved]\` to those that no longer apply, and add new ones with new ids.
- Name the code by path and symbol so the finding can be verified; do not paste code.
- Touch nothing outside the ${FINDINGS_SECTION} section; the spec's items are the planner's and the user's.

Your second output: the task board, \`${tasks}\`, written with Write. Start from one task per scenario of the spec, in build order, each naming the spec items it delivers and the files it touches. Structure:

\`\`\`markdown
# Tasks for ${feature}

- T1 (B1, E1, B2): the scenario, as work: what to do, in one line
  - files: src/orders/cancel.ts, src/orders/cancel.test.ts (new)
  - context: src/orders/order.ts, src/orders/ship.test.ts, docs/intent/orders.md
- T2 (B3): ...
  - files: src/orders/reservation.ts
  - context: src/orders/order.ts, src/billing/invoice.ts
\`\`\`

Rules:
- One task per scenario is the default; depart from it only for a reason you name in the task text: a scenario too big for one sitting is split in build order, a foundation every scenario needs (a contract module, a schema) is one task shared by all, delivering the items it serves in each.
- Every behaviour and edge case of the spec is delivered by some task. An item no task delivers is a gap the user sees.
- The files are workspace-relative paths that exist, or paths to create marked \`(new)\`, placed where the code around them says such a file belongs. The tests that prove a task's items are files of that task.
- The context is what you read to arrive at the task and the implementer would otherwise have to find again: the modules the task's files lean on, the test that shows the pattern to follow, the place the term already lives. Existing paths only, the few that matter; a task starts from its files and its context and searches beyond them only when those do not answer.
- Task ids are stable: never renumber. On a re-run, keep a task that still holds and update its text, files and context, append \` [removed]\` to one that no longer applies, add new ones with new ids. Never touch a marker or a \`proves:\` line the implementer left on a task (\`[in progress]\`, \`[done]\`, \`[tested]\`, \`[blocked: ...]\`).
- No task for what a finding puts in question: the user rules on the finding first. Say in the finding what the task would be.
- The file's front matter and a \`## Verification\` section at its end are the extension's; leave them alone.
- A \`## Tasks\` section left in the spec from before the board existed is yours to delete once the board holds its content; the spec's items are otherwise not yours.
- When both files are written, stop. Say nothing more: findings and tasks are read from the files.`
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
    case 'Skill':
      return clip(`Skill ${text('name') ?? text('skill') ?? ''}`)
    default:
      return name
  }
}

function clip(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyRenames,
  collectRenames,
  extractLegacyTasks,
  migratePlan,
  modernizeFindings,
  modernizeIntent,
  modernizeReview,
  modernizeSpecItems,
  modernizeTasks,
} from '../src/agent/phases/migrate-plan'
import { migrateSpecPrompt } from '../src/agent/phases/blind-plan'
import { decisions } from '../src/agent/phases/decisions'
import { parseAmendments } from '../src/agent/phases/intent-writeback'
import { parseReview } from '../src/agent/phases/plan-review'
import { parseSpecText } from '../src/agent/phases/spec-model'
import { parseTasks } from '../src/agent/phases/tasks-file'

const legacy = `---
feature: Orders
status: approved
---

# Orders

## Goal
Orders can be cancelled.

## Behaviour
- B1: an order can be cancelled
- B2: a cancelled order is refunded

## Edge cases
- E1: a shipped order cannot be cancelled

## Tasks
- T1: add the cancel command (B1, E1) [done]
- T2 (B2): refund

## Open questions
- Q1: partial refunds?
`

describe('legacy task section', () => {
  it('lifts_the_tasks_out_of_the_spec_with_the_delivered_ids_first', () => {
    const { spec, tasks } = extractLegacyTasks(legacy)
    expect(tasks).toEqual(['- T1 (B1, E1): add the cancel command [done]', '- T2 (B2): refund'])
    expect(spec).not.toContain('## Tasks')
    expect(spec).toContain('## Open questions\n- Q1: partial refunds?')
    expect(spec).toContain('## Edge cases\n- E1')
  })

  it('a_spec_without_a_task_section_is_left_alone', () => {
    const text = '# X\n\n## Goal\ng\n\n## S\n- **A**: a\n'
    expect(extractLegacyTasks(text)).toEqual({ spec: text, tasks: [] })
  })
})

describe('ids become names', () => {
  it('legacy_id_lines_become_named_rules_with_the_citation_after_the_text', () => {
    const old = '## S\n- B1 (docs/intent/x.md#Cancel it): text [removed]\n  - E1: an edge\n- B7: the invariant (was I1)\n- Q1: why?\n'
    expect(modernizeSpecItems(old)).toBe(
      '## S\n- **B1**: text (docs/intent/x.md#Cancel it) [removed]\n  - **E1**: an edge\n- **B7** (was I1): the invariant\n- **Q1**: why?\n',
    )
    expect(modernizeSpecItems(modernizeSpecItems(old))).toBe(modernizeSpecItems(old))
  })

  it('a_findings_table_becomes_decisions_titled_by_the_old_id', () => {
    const old = `## S
- **B1**: a

## Findings
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B1): the code says otherwise | keep B1 |
| F2 (naive, B11/E5): assumed [resolved] | change it |
| F3 (breakage, T1): reports break [removed] | |
`
    const text = modernizeFindings(old)
    expect(text).toBe(`## S
- **B1**: a

## Decisions
### F1
- on: B1
- finding: the code says otherwise
- proposed: keep B1

### F2 [applied]
- on: B11, E5
- finding: assumed
- proposed: change it

### F3 [withdrawn]
- on: T1
- finding: reports break
`)
    expect(decisions(text).map((d) => [d.title, d.state, d.on])).toEqual([
      ['F1', 'open', ['B1']],
      ['F2', 'applied', ['B11', 'E5']],
      ['F3', 'withdrawn', ['T1']],
    ])
    expect(modernizeFindings(text)).toBe(text)
  })

  it('a_migrated_board_names_its_tasks_and_pairs_each_proof_with_an_arrow', () => {
    const old = '# Tasks for X\n\n- T1 (B1, E1): a [tested]\n  - files: src/a.ts\n  - proves: B1 test/a.test.ts b1_holds, E1 test/a.test.ts e1_holds\n- T2: b\n'
    const text = modernizeTasks(old)
    expect(text).toBe('# Tasks for X\n\n- **T1** (B1, E1): a [tested]\n  - files: src/a.ts\n  - proves: B1 → test/a.test.ts b1_holds, E1 → test/a.test.ts e1_holds\n- **T2**: b\n')
    expect(parseTasks(text).tasks.map((t) => [t.name, t.delivers, t.proves.length])).toEqual([
      ['T1', ['B1', 'E1'], 2],
      ['T2', [], 0],
    ])
    expect(modernizeTasks(text)).toBe(text)
  })

  it('a_migrated_review_loses_its_ids_and_keeps_its_resolutions', () => {
    const old =
      '# Review\n\nComments and strikes are the human’s; resolutions are the agent’s. A submitted comment keeps its id.\n\n## Round 1 — submitted t\n- C1 (B3): hm\n  - item: B3: a rule\n  - addressed: ok\n  - accepted\n- C2 (plan): thin\n- struck: B2, E1\n\n## Round 2 — pending\n- C3 (B1): no\n'
    const text = modernizeReview(old)
    expect(text).toBe(
      '# Review\n\nComments and strikes are the human’s; resolutions are the agent’s. A comment names the rule it is on.\n\n## Round 1, submitted t\n- on B3: hm\n  - item: B3: a rule\n  - addressed: ok\n  - resolved\n- on the plan: thin\n- remove: B2, E1\n\n## Round 2, pending\n- on B1: no\n',
    )
    const review = parseReview(text)
    expect(review.rounds[0]!.comments.map((c) => [c.target, c.closed ?? false])).toEqual([
      ['B3', true],
      ['plan', false],
    ])
    expect(review.rounds[0]!.strikes).toEqual(['B2', 'E1'])
    expect(modernizeReview(text)).toBe(text)
  })

  it('a_migrated_amendment_is_headed_by_its_target_spaces_and_all', () => {
    const old =
      '## A1 (append) docs/intent/orders.md#Cancellation [applied]\n- from: F3\n\ntext\n\n## A2 (new) docs/intent/x.md\n\nmore\n\n## A3 (replace) docs/intent/agent.md#Phase 1: Blind plan\n\nspaced\n'
    const text = modernizeIntent(old)
    expect(text).toBe(
      '## docs/intent/orders.md#Cancellation (append) [applied]\n- from: F3\n\ntext\n\n## docs/intent/x.md (new)\n\nmore\n\n## docs/intent/agent.md#Phase 1: Blind plan (replace)\n\nspaced\n',
    )
    expect(parseAmendments(text).map((a) => [a.doc, a.heading, a.mode, a.applied])).toEqual([
      ['docs/intent/orders.md', 'Cancellation', 'append', true],
      ['docs/intent/x.md', undefined, 'new', false],
      ['docs/intent/agent.md', 'Phase 1: Blind plan', 'replace', false],
    ])
    expect(modernizeIntent(text)).toBe(text)
  })
})

describe('renames', () => {
  it('a_was_note_after_the_name_is_renamed_through_every_file', () => {
    const spec = '## S\n- **Exact answers** (was I1): the answers are exactly what the user submitted\n  - **Trimmed** (was A3): x\n- **Other**: y\n'
    const { spec: cleaned, renames } = collectRenames(spec)
    expect(cleaned).toBe('## S\n- **Exact answers**: the answers are exactly what the user submitted\n  - **Trimmed**: x\n- **Other**: y\n')
    expect([...renames]).toEqual([
      ['I1', 'Exact answers'],
      ['A3', 'Trimmed'],
    ])
    expect(applyRenames('- on I1: too vague\n- remove: A3, I10\n- on: I1, A3', renames)).toBe(
      '- on Exact answers: too vague\n- remove: Trimmed, I10\n- on: Exact answers, Trimmed',
    )
    // A multi-word name is renamed whole, and one that is a prefix of another is left alone.
    const again = collectRenames('- **Exact match** (was Exact answers): z\n').renames
    expect(applyRenames('Exact answers, Exact answers first', again)).toBe('Exact match, Exact match first')
  })
})

describe('migratePlan', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrate-'))
    await mkdir(join(dir, 'plan'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('moves_the_task_section_into_a_new_tasks_file_and_reports_what_the_planner_has_left_to_do', async () => {
    await writeFile(join(dir, 'plan', 'orders.spec.md'), legacy)
    const report = await migratePlan(dir, 'Orders')
    expect(report.steps).toEqual([
      'moved 2 task line(s) from the spec into the tasks file.',
      'rewrote the spec to the named-rule contract.',
      'rewrote the tasks file to the named-rule contract.',
      'stamped the tasks file with the spec it was mapped from.',
    ])
    const board = parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8'))
    expect(board.tasks.map((t) => [t.name, t.delivers, t.state])).toEqual([
      ['T1', ['B1', 'E1'], 'done'],
      ['T2', ['B2'], 'open'],
    ])
    const spec = await readFile(join(dir, 'plan', 'orders.spec.md'), 'utf8')
    expect(spec).not.toContain('## Tasks')
    expect(spec).toContain('status: approved')
    expect(spec).toContain('- **B1**: an order can be cancelled')
    // The old sections read as scenarios and the old ids as names; giving them real names is the planner's, when asked.
    expect(report.problems).toEqual([])
    expect(parseSpecText(spec).scenarios.map((s) => s.title)).toEqual(['Behaviour', 'Edge cases'])
  })

  it('a_spec_the_planner_still_has_to_arrange_is_not_stamped_onto_its_board', async () => {
    await writeFile(join(dir, 'plan', 'orders.spec.md'), '# Orders\n\n## Goal\ng\n\n## S\n- **A**: a\n- a rule without a name\n')
    await writeFile(join(dir, 'plan', 'orders.tasks.md'), '# Tasks for Orders\n\n- **T1** (A): x\n')
    const report = await migratePlan(dir, 'Orders')
    expect(report.steps).toEqual([])
    expect(report.problems).toEqual(['line 8: "- a rule without a name": a rule without a name; a rule is `- **Name**: text`.'])
    expect(parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8')).spec).toBeUndefined()
  })

  it('a_current_format_plan_is_rewritten_in_every_file_and_the_board_is_restamped', async () => {
    await writeFile(
      join(dir, 'plan', 'orders.spec.md'),
      '# Orders\n\n## Goal\ng\n\n## Cancelling\n- B1 (docs/intent/orders.md#Cancel): a\n  - E1: b\n\n## Findings\n| Finding | Proposed solution |\n|---|---|\n| F1 (naive, B1): x [resolved] | y |\n',
    )
    await writeFile(join(dir, 'plan', 'orders.tasks.md'), '---\nspec: 00000000\n---\n# Tasks for Orders\n\n- T1 (B1, E1): x [tested]\n  - proves: B1 test/a.test.ts holds\n')
    await writeFile(join(dir, 'plan', 'orders.review.md'), '# Review\n\n## Round 1 — submitted t\n- C1 (B1): hm\n  - addressed: ok\n  - accepted\n')
    await writeFile(join(dir, 'plan', 'orders.intent.md'), '## A1 (append) docs/intent/orders.md#Cancel\n\ntext\n')
    const report = await migratePlan(dir, 'Orders')
    expect(report.problems).toEqual([])
    expect(report.steps).toEqual([
      'rewrote the spec to the named-rule contract.',
      'rewrote the tasks file to the named-rule contract.',
      'rewrote the review to the named-rule contract.',
      'rewrote the intent file to the named-rule contract.',
      'stamped the tasks file with the spec it was mapped from.',
    ])
    const spec = parseSpecText(await readFile(join(dir, 'plan', 'orders.spec.md'), 'utf8'))
    expect(spec.scenarios[0]!.behaviours[0]).toMatchObject({ name: 'B1', citation: 'docs/intent/orders.md#Cancel', edges: [{ name: 'E1' }] })
    expect(spec.decisions.map((d) => d.state)).toEqual(['applied'])
    const board = parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8'))
    expect(board.tasks[0]).toMatchObject({ name: 'T1', delivers: ['B1', 'E1'], proves: [{ item: 'B1' }] })
    expect(board.spec).toMatch(/^[0-9a-f]{8}$/)
    expect(board.spec).not.toBe('00000000')
    expect(parseReview(await readFile(join(dir, 'plan', 'orders.review.md'), 'utf8')).rounds[0]!.comments[0]).toMatchObject({ target: 'B1', closed: true })
    expect(parseAmendments(await readFile(join(dir, 'plan', 'orders.intent.md'), 'utf8'))[0]).toMatchObject({ heading: 'Cancel', mode: 'append' })
    // Running it again changes nothing.
    expect((await migratePlan(dir, 'Orders')).steps).toEqual([])
  })

  it('after_the_planners_turn_the_renames_are_followed_and_the_board_is_stamped', async () => {
    await writeFile(
      join(dir, 'plan', 'orders.spec.md'),
      '# Orders\n\n## Goal\ng\n\n## Cancelling\n- **B1**: a\n  - **E1**: b\n- **The invariant** (was I1): the invariant, now a rule\n',
    )
    await writeFile(join(dir, 'plan', 'orders.tasks.md'), '# Tasks for Orders\n\n- **T1** (B1, I1): x\n')
    await writeFile(join(dir, 'plan', 'orders.review.md'), '# Review\n\n## Round 1, submitted t\n- on I1: hm\n  - addressed: ok\n')
    const report = await migratePlan(dir, 'Orders')
    expect(report.problems).toEqual([])
    expect(report.steps).toEqual([
      'renamed I1 → The invariant across the spec, the review and the tasks file.',
      'stamped the tasks file with the spec it was mapped from.',
    ])
    expect(await readFile(join(dir, 'plan', 'orders.spec.md'), 'utf8')).toContain('- **The invariant**: the invariant, now a rule\n')
    expect(await readFile(join(dir, 'plan', 'orders.review.md'), 'utf8')).toContain('- on The invariant: hm')
    const board = parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8'))
    expect(board.tasks[0]!.delivers).toEqual(['B1', 'The invariant'])
    expect(board.spec).toMatch(/^[0-9a-f]{8}$/)
    // Running it again changes nothing.
    expect((await migratePlan(dir, 'Orders')).steps).toEqual([])
  })

  it('a_broken_intent_file_and_a_missing_spec_are_reported_not_hidden', async () => {
    expect((await migratePlan(dir, 'Nope')).problems).toEqual(['no spec file.'])
  })

  it('the_planner_is_told_where_each_kind_of_leftover_goes', () => {
    const prompt = migrateSpecPrompt('Orders', ['line 3: I1: ...'])
    expect(prompt).toContain('plan/orders.spec.md')
    expect(prompt).toContain('line 3: I1: ...')
    expect(prompt).toContain('(was I3)')
    expect(prompt).toContain('(was B5)')
    expect(prompt).toContain('keeps its name')
    expect(prompt).toContain('Tasks')
  })
})

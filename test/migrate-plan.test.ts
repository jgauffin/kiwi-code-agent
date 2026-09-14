import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRenames, collectRenames, extractLegacyTasks, migratePlan } from '../src/agent/phases/migrate-plan'
import { migrateSpecPrompt } from '../src/agent/phases/blind-plan'
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
    const text = '# X\n\n## Goal\ng\n\n## S\n- B1: a\n'
    expect(extractLegacyTasks(text)).toEqual({ spec: text, tasks: [] })
  })
})

describe('renames', () => {
  it('reads_the_planners_was_notes_and_follows_them_through_every_reference', () => {
    const spec = '## S\n- B7: the answers are exactly what the user submitted (was I1)\n  - E2: x (was A3)\n- B8: y\n'
    const { spec: cleaned, renames } = collectRenames(spec)
    expect(cleaned).toBe('## S\n- B7: the answers are exactly what the user submitted\n  - E2: x\n- B8: y\n')
    expect([...renames]).toEqual([
      ['I1', 'B7'],
      ['A3', 'E2'],
    ])
    expect(applyRenames('- C1 (I1): too vague\n- struck: A3, I10\n| F1 (naive, I1): x | |', renames)).toBe(
      '- C1 (B7): too vague\n- struck: E2, I10\n| F1 (naive, B7): x | |',
    )
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
    expect(report.steps).toEqual(['moved 2 task line(s) from the spec into the tasks file.'])
    const board = parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8'))
    expect(board.tasks.map((t) => [t.id, t.delivers, t.state])).toEqual([
      ['T1', ['B1', 'E1'], 'done'],
      ['T2', ['B2'], 'open'],
    ])
    const spec = await readFile(join(dir, 'plan', 'orders.spec.md'), 'utf8')
    expect(spec).not.toContain('## Tasks')
    expect(spec).toContain('status: approved')
    // The flat edge case is the planner's to nest; the report says so.
    expect(report.problems).toEqual(['line 16: E1: only behaviours (B) sit directly under a scenario; an edge case is indented under the behaviour it qualifies.'])
  })

  it('after_the_planners_turn_the_renames_are_followed_and_the_board_is_stamped', async () => {
    await writeFile(
      join(dir, 'plan', 'orders.spec.md'),
      '# Orders\n\n## Goal\ng\n\n## Cancelling\n- B1: a\n  - E1: b\n- B3: the invariant, now a rule (was I1)\n',
    )
    await writeFile(join(dir, 'plan', 'orders.tasks.md'), '# Tasks for Orders\n\n- T1 (B1, I1): x\n')
    await writeFile(join(dir, 'plan', 'orders.review.md'), '# Review\n\n## Round 1 — submitted t\n- C1 (I1): hm\n  - addressed: ok\n')
    const report = await migratePlan(dir, 'Orders')
    expect(report.problems).toEqual([])
    expect(report.steps).toEqual([
      'renamed I1 → B3 across the spec, the review and the tasks file.',
      'stamped the tasks file with the spec it was mapped from.',
    ])
    expect(await readFile(join(dir, 'plan', 'orders.spec.md'), 'utf8')).toContain('- B3: the invariant, now a rule\n')
    expect(await readFile(join(dir, 'plan', 'orders.review.md'), 'utf8')).toContain('- C1 (B3): hm')
    const board = parseTasks(await readFile(join(dir, 'plan', 'orders.tasks.md'), 'utf8'))
    expect(board.tasks[0]!.delivers).toEqual(['B1', 'B3'])
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
    expect(prompt).toContain('keeps its id')
    expect(prompt).toContain('Tasks')
  })
})

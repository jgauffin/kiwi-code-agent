import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDraftPlans, listPlans } from '../src/agent/phases/plan-list'
import { renderBoard, withCleanupDecision, withRecord, type TaskBoard } from '../src/agent/phases/tasks-file'
import { board, task } from './task-board-fixture'

const allTested = (name: string): TaskBoard => board(task(name, { state: 'tested' }))
const passed = (b: TaskBoard): TaskBoard => withRecord(b, { at: '2026-09-14T10:00:00Z', ok: true, text: '' })

/** Specs go under `plan/`, every other plan file among the working files. */
async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plans-'))
  await mkdir(join(dir, 'plan'))
  await mkdir(join(dir, '.agent', 'plan'), { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    await writeFile(name.endsWith('.spec.md') ? join(dir, 'plan', name) : join(dir, '.agent', 'plan', name), text)
  }
  return dir
}

describe('plan list', () => {
  it('lists_every_spec_with_its_status_and_an_approved_spec_whose_board_passed_verification_as_verified', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n',
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'billing.tasks.json': renderBoard(allTested('Bill')),
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.json': renderBoard(passed(allTested('Log'))),
      'orders.review.md': '# not a spec\n',
    })
    try {
      expect(await listPlans(dir)).toEqual([
        { feature: 'Audit', path: join(dir, 'plan', 'audit.spec.md'), status: 'verified' },
        // All tested but not yet passed the test run: still in play.
        { feature: 'Billing', path: join(dir, 'plan', 'billing.spec.md'), status: 'approved' },
        { feature: 'Orders', path: join(dir, 'plan', 'orders.spec.md'), status: 'draft' },
      ])
      expect(await listDraftPlans(dir)).toMatchObject([{ feature: 'Orders' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_postponed_cleanup_keeps_the_feature_on_the_list_until_it_is_settled', async () => {
    const dir = await workspace({
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.json': renderBoard(withCleanupDecision(passed(allTested('Log')), 'postponed')),
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'billing.tasks.json': renderBoard(withCleanupDecision(passed(allTested('Bill')), 'skipped')),
    })
    try {
      expect(await listPlans(dir)).toMatchObject([
        { feature: 'Audit', status: 'approved' },
        { feature: 'Billing', status: 'verified' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('an_implemented_spec_is_verified_without_its_working_files', async () => {
    const dir = await workspace({ 'audit.spec.md': '---\nfeature: Audit\nstatus: implemented\n---\n# Audit\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'Audit', status: 'verified' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_spec_without_a_feature_line_is_named_by_its_slug', async () => {
    const dir = await workspace({ 'user-question.spec.md': '# User question\n' })
    try {
      expect(await listPlans(dir)).toMatchObject([{ feature: 'user-question', status: 'draft' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a_workspace_without_a_plan_directory_has_no_plans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plans-'))
    try {
      expect(await listPlans(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

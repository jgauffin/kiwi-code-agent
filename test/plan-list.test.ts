import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDraftPlans, listPlans } from '../src/agent/phases/plan-list'

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plans-'))
  await mkdir(join(dir, 'plan'))
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, 'plan', name), text)
  return dir
}

describe('plan list', () => {
  it('lists_every_spec_with_its_status_and_an_approved_spec_whose_board_passed_verification_as_verified', async () => {
    const dir = await workspace({
      'orders.spec.md': '---\nfeature: Orders\nstatus: draft\n---\n# Orders\n',
      'billing.spec.md': '---\nfeature: Billing\nstatus: approved\n---\n# Billing\n',
      'billing.tasks.md': '# Tasks for Billing\n\n- **Bill**: bill [tested]\n',
      'audit.spec.md': '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n',
      'audit.tasks.md': '# Tasks for Audit\n\n- **Log**: log [tested]\n\n## Verification\n- 2026-09-14T10:00:00Z: passed\n',
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

import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sweepPlans } from '../src/agent/phases/plan-housekeeping'

const NOW = new Date('2026-09-27T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

const approvedSpec = '---\nfeature: Audit\nstatus: approved\n---\n# Audit\n'
const passed = '\n## Verification\n- 2026-09-14T10:00:00Z: passed\n'
const finishedBoard = `# Tasks for Audit\n\n- **Log**: log [tested]\n${passed}`

let dir: string

/** Files by workspace-relative path, each last touched the given number of days before NOW. */
async function workspace(files: Record<string, string>, ageDays: number): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'housekeeping-'))
  const touched = new Date(NOW.getTime() - ageDays * DAY)
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    await utimes(file, touched, touched)
  }
  return dir
}

const exists = (path: string) =>
  access(join(dir, path)).then(
    () => true,
    () => false,
  )

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('plan housekeeping', () => {
  it('finished_feature_idle_a_week_is_marked_implemented_and_loses_its_working_files', async () => {
    await workspace(
      {
        'plan/audit.spec.md': approvedSpec,
        '.agent/plan/audit.tasks.md': finishedBoard,
        '.agent/plan/audit.review.md': '# Review\n',
        '.agent/plan/audit.decisions.md': '# Decisions\n',
      },
      8,
    )
    const report = await sweepPlans(dir, NOW)
    expect(await readFile(join(dir, 'plan/audit.spec.md'), 'utf8')).toContain('status: implemented')
    expect(await exists('.agent/plan/audit.tasks.md')).toBe(false)
    expect(await exists('.agent/plan/audit.review.md')).toBe(false)
    expect(await exists('.agent/plan/audit.decisions.md')).toBe(false)
    expect(report.implemented).toEqual(['plan/audit.spec.md'])
  })

  it('finished_feature_touched_this_week_keeps_its_working_files', async () => {
    await workspace({ 'plan/audit.spec.md': approvedSpec, '.agent/plan/audit.tasks.md': finishedBoard }, 6)
    await sweepPlans(dir, NOW)
    expect(await readFile(join(dir, 'plan/audit.spec.md'), 'utf8')).toContain('status: approved')
    expect(await exists('.agent/plan/audit.tasks.md')).toBe(true)
  })

  it('feature_under_development_keeps_its_working_files_however_old', async () => {
    await workspace(
      { 'plan/audit.spec.md': approvedSpec, '.agent/plan/audit.tasks.md': '# Tasks for Audit\n\n- **Log**: log [in progress]\n' },
      90,
    )
    await sweepPlans(dir, NOW)
    expect(await exists('.agent/plan/audit.tasks.md')).toBe(true)
  })

  it('a_draft_under_review_keeps_its_working_files_however_old', async () => {
    await workspace({ 'plan/audit.spec.md': '---\nstatus: draft\n---\n# Audit\n', '.agent/plan/audit.review.md': '# Review\n' }, 90)
    await sweepPlans(dir, NOW)
    expect(await exists('.agent/plan/audit.review.md')).toBe(true)
  })

  it('postponed_cleanup_keeps_the_feature_open', async () => {
    await workspace(
      { 'plan/audit.spec.md': approvedSpec, '.agent/plan/audit.tasks.md': `---\ncleanup: postponed\n---\n${finishedBoard}` },
      90,
    )
    await sweepPlans(dir, NOW)
    expect(await exists('.agent/plan/audit.tasks.md')).toBe(true)
    expect(await readFile(join(dir, 'plan/audit.spec.md'), 'utf8')).toContain('status: approved')
  })

  it('working_files_without_a_spec_are_removed_after_a_week', async () => {
    await workspace({ '.agent/plan/gone.tasks.md': '# Tasks\n', '.agent/plan/gone.review.md': '# Review\n' }, 8)
    const report = await sweepPlans(dir, NOW)
    expect(await exists('.agent/plan/gone.tasks.md')).toBe(false)
    expect(await exists('.agent/plan/gone.review.md')).toBe(false)
    expect(report.removed).toHaveLength(2)
  })

  it('working_files_without_a_spec_survive_the_first_week_since_a_branch_switch_can_hide_the_spec', async () => {
    await workspace({ '.agent/plan/gone.tasks.md': '# Tasks\n' }, 6)
    await sweepPlans(dir, NOW)
    expect(await exists('.agent/plan/gone.tasks.md')).toBe(true)
  })

  it('legacy_working_files_under_plan_move_to_the_work_dir_and_the_spec_stays', async () => {
    await workspace(
      {
        'plan/audit.spec.md': '---\nstatus: draft\n---\n# Audit\n',
        'plan/audit.review.md': '# Review\n',
        'plan/audit.decisions.md': '# Decisions\n',
        'plan/audit.tasks.md': '# Tasks\n',
      },
      0,
    )
    const report = await sweepPlans(dir, NOW)
    expect(await exists('plan/audit.spec.md')).toBe(true)
    for (const kind of ['review', 'decisions', 'tasks']) {
      expect(await exists(`plan/audit.${kind}.md`)).toBe(false)
      expect(await exists(`.agent/plan/audit.${kind}.md`)).toBe(true)
    }
    expect(report.moved).toHaveLength(3)
  })

  it('a_legacy_file_is_left_in_place_when_the_work_dir_already_holds_one', async () => {
    await workspace(
      { 'plan/audit.spec.md': '---\nstatus: draft\n---\n# Audit\n', 'plan/audit.tasks.md': '# old\n', '.agent/plan/audit.tasks.md': '# new\n' },
      0,
    )
    const report = await sweepPlans(dir, NOW)
    expect(await readFile(join(dir, 'plan/audit.tasks.md'), 'utf8')).toBe('# old\n')
    expect(await readFile(join(dir, '.agent/plan/audit.tasks.md'), 'utf8')).toBe('# new\n')
    expect(report.blocked).toEqual(['plan/audit.tasks.md'])
  })

  it('a_finished_feature_whose_week_old_working_files_are_still_under_plan_is_swept_in_the_same_run', async () => {
    await workspace({ 'plan/audit.spec.md': approvedSpec, 'plan/audit.tasks.md': finishedBoard, 'plan/audit.review.md': '# Review\n' }, 8)
    await sweepPlans(dir, NOW)
    expect(await readFile(join(dir, 'plan/audit.spec.md'), 'utf8')).toContain('status: implemented')
    for (const path of ['plan/audit.tasks.md', 'plan/audit.review.md', '.agent/plan/audit.tasks.md', '.agent/plan/audit.review.md']) {
      expect(await exists(path)).toBe(false)
    }
  })

  it('a_copy_left_under_plan_beside_its_working_file_goes_when_the_feature_is_swept', async () => {
    await workspace({ 'plan/audit.spec.md': approvedSpec, 'plan/audit.tasks.md': '# old\n', '.agent/plan/audit.tasks.md': finishedBoard }, 8)
    await sweepPlans(dir, NOW)
    expect(await exists('plan/audit.tasks.md')).toBe(false)
    expect(await exists('.agent/plan/audit.tasks.md')).toBe(false)
  })

  it('a_workspace_without_plans_sweeps_nothing', async () => {
    await workspace({}, 0)
    expect(await sweepPlans(dir, NOW)).toEqual({ moved: [], blocked: [], implemented: [], removed: [] })
  })
})

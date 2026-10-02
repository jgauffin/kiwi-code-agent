import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { migrateLayout } from '../src/agent/kiwi-dir'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'kiwi-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'kiwi-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function files(root: string, paths: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(paths)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

const text = (root: string, path: string) => readFile(join(root, path), 'utf8')

describe('migrateLayout', () => {
  it('the_agent_folder_moves_to_kiwi_with_its_working_files_under_specs', async () => {
    await files(cwd, {
      '.agent/runs/s1/events.jsonl': 'log',
      '.agent/repo-map/index.md': 'map',
      '.agent/docs-map/index.md': 'docs',
      '.agent/sessions/s1.json': '{}',
      '.agent/scratch/s1/a.txt': 'a',
      '.agent/skills/x/SKILL.md': 'skill',
      '.agent/plan/audit.tasks.json': '{}',
    })
    const report = await migrateLayout(cwd, home)
    expect(await text(cwd, '.kiwi/runs/s1/events.jsonl')).toBe('log')
    expect(await text(cwd, '.kiwi/repo-map/index.md')).toBe('map')
    expect(await text(cwd, '.kiwi/docs-map/index.md')).toBe('docs')
    expect(await text(cwd, '.kiwi/sessions/s1.json')).toBe('{}')
    expect(await text(cwd, '.kiwi/scratch/s1/a.txt')).toBe('a')
    expect(await text(cwd, '.kiwi/skills/x/SKILL.md')).toBe('skill')
    expect(await text(cwd, '.kiwi/specs/audit.tasks.json')).toBe('{}')
    expect(await exists(join(cwd, '.agent'))).toBe(false)
    expect(report.blocked).toEqual([])
    expect(report.moved).toContainEqual({ from: '.agent/plan', to: '.kiwi/specs' })
  })

  it('what_another_tool_keeps_in_the_agent_folder_stays_there', async () => {
    await files(cwd, { '.agent/runs/r.jsonl': 'log', '.agent/other-tool.json': '{}' })
    await migrateLayout(cwd, home)
    expect(await text(cwd, '.agent/other-tool.json')).toBe('{}')
    expect(await exists(join(cwd, '.agent/runs'))).toBe(false)
    expect(await text(cwd, '.kiwi/runs/r.jsonl')).toBe('log')
  })

  it('the_plan_folder_becomes_specs', async () => {
    await files(cwd, { 'plan/audit.spec.md': 'spec', 'plan/unfiled-decisions.md': 'unfiled' })
    const report = await migrateLayout(cwd, home)
    expect(await text(cwd, 'specs/audit.spec.md')).toBe('spec')
    expect(await text(cwd, 'specs/unfiled-decisions.md')).toBe('unfiled')
    expect(await exists(join(cwd, 'plan'))).toBe(false)
    expect(report.moved).toEqual([{ from: 'plan', to: 'specs' }])
  })

  it('a_spec_whose_name_specs_already_holds_is_left_in_plan_and_reported', async () => {
    await files(cwd, { 'specs/audit.spec.md': 'new', 'plan/audit.spec.md': 'old', 'plan/login.spec.md': 'login' })
    const report = await migrateLayout(cwd, home)
    expect(await text(cwd, 'specs/audit.spec.md')).toBe('new')
    expect(await text(cwd, 'plan/audit.spec.md')).toBe('old')
    expect(await text(cwd, 'specs/login.spec.md')).toBe('login')
    expect(report.blocked).toEqual(['plan/audit.spec.md'])
  })

  it('a_kiwi_folder_that_already_holds_an_entry_keeps_it_and_the_old_one_is_reported', async () => {
    await files(cwd, { '.kiwi/runs/s1/events.jsonl': 'new', '.agent/runs/s1/events.jsonl': 'old', '.agent/runs/s2/events.jsonl': 'two' })
    const report = await migrateLayout(cwd, home)
    expect(await text(cwd, '.kiwi/runs/s1/events.jsonl')).toBe('new')
    expect(await text(cwd, '.agent/runs/s1/events.jsonl')).toBe('old')
    expect(await text(cwd, '.kiwi/runs/s2/events.jsonl')).toBe('two')
    expect(report.blocked).toEqual(['.agent/runs/s1'])
  })

  it('the_users_own_skills_move_from_the_home_agent_folder', async () => {
    await files(home, { '.agent/skills/x/SKILL.md': 'skill' })
    const report = await migrateLayout(cwd, home)
    expect(await text(home, '.kiwi/skills/x/SKILL.md')).toBe('skill')
    expect(report.moved).toEqual([{ from: '~/.agent/skills', to: '~/.kiwi/skills' }])
  })

  it('a_migrated_workspace_is_left_as_it_is', async () => {
    await files(cwd, { 'specs/audit.spec.md': 'spec', '.kiwi/runs/r.jsonl': 'log' })
    expect(await migrateLayout(cwd, home)).toEqual({ moved: [], blocked: [], failed: [] })
  })

  it('an_entry_the_system_refuses_to_move_is_reported_and_the_rest_of_the_layout_still_moves', async () => {
    await files(cwd, { '.kiwi/scratch': 'a file where the folder belongs', '.agent/scratch/s1/a.txt': 'a', '.agent/plan/audit.tasks.json': '{}', 'plan/audit.spec.md': 'spec' })
    const report = await migrateLayout(cwd, home)
    expect(report.failed.map((failure) => failure.path)).toEqual(['.agent/scratch/s1'])
    expect(report.failed[0]?.reason).toBeTruthy()
    expect(await text(cwd, '.agent/scratch/s1/a.txt')).toBe('a')
    expect(await text(cwd, '.kiwi/specs/audit.tasks.json')).toBe('{}')
    expect(await text(cwd, 'specs/audit.spec.md')).toBe('spec')
  })
})

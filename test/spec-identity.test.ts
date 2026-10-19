import { afterEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { followSpecRenames, recordSpecId, specIdOf, SPEC_IDS_FILE } from '../src/agent/phases/spec-identity'

let dir: string

async function workspace(files: Record<string, string>): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'spec-identity-'))
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
}

const text = (path: string) => readFile(join(dir, path), 'utf8')
const exists = (path: string) =>
  access(join(dir, path)).then(
    () => true,
    () => false,
  )
const move = async (from: string, to: string) => {
  await mkdir(dirname(join(dir, to)), { recursive: true })
  await rename(join(dir, from), join(dir, to))
}

const spec = (feature: string, id?: string) => `---\nfeature: ${feature}\nstatus: approved\n${id ? `id: ${id}\n` : ''}---\n# ${feature}\n`

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('spec identity', () => {
  it('a_spec_without_an_id_is_given_one_and_keeps_the_rest_of_its_front_matter', async () => {
    await workspace({ 'specs/audit.spec.md': spec('Audit') })

    const report = await followSpecRenames(dir)

    const written = await text('specs/audit.spec.md')
    expect(specIdOf(written)).toMatch(/^[0-9a-f-]{36}$/)
    expect(written).toContain('feature: Audit\nstatus: approved\n')
    expect(report.stamped).toEqual(['specs/audit.spec.md'])
  })

  it('a_renamed_spec_takes_its_working_files_and_names_the_sessions_to_follow', async () => {
    await workspace({
      'specs/permission-decisions.spec.md': spec('Permission rules', 'abc'),
      '.kiwi/specs/permission-decisions.tasks.json': '{}',
      '.kiwi/specs/permission-decisions.context.md': '# Context\n',
    })
    await followSpecRenames(dir)
    await move('specs/permission-decisions.spec.md', 'specs/sessions/permission-rules.spec.md')

    const report = await followSpecRenames(dir)

    expect(report.renamed).toEqual([{ from: 'permission-decisions', to: 'permission-rules', feature: 'Permission rules' }])
    expect(await exists('.kiwi/specs/permission-rules.tasks.json')).toBe(true)
    expect(await exists('.kiwi/specs/permission-rules.context.md')).toBe(true)
    expect(await exists('.kiwi/specs/permission-decisions.tasks.json')).toBe(false)
    expect(JSON.parse(await text(SPEC_IDS_FILE))).toEqual({ abc: 'permission-rules' })
  })

  it('a_renamed_spec_whose_feature_line_still_says_the_old_name_goes_by_its_file_name', async () => {
    await workspace({ 'specs/old.spec.md': spec('Old', 'abc') })
    await followSpecRenames(dir)
    await move('specs/old.spec.md', 'specs/new.spec.md')

    const report = await followSpecRenames(dir)

    expect(report.renamed).toEqual([{ from: 'old', to: 'new', feature: 'new' }])
  })

  it('a_working_file_the_new_name_already_holds_is_left_under_the_old_name', async () => {
    await workspace({
      'specs/old.spec.md': spec('Old', 'abc'),
      '.kiwi/specs/old.review.md': 'old review',
      '.kiwi/specs/new.review.md': 'new review',
    })
    await followSpecRenames(dir)
    await move('specs/old.spec.md', 'specs/new.spec.md')

    const report = await followSpecRenames(dir)

    expect(report.blocked).toEqual(['.kiwi/specs/old.review.md'])
    expect(await text('.kiwi/specs/new.review.md')).toBe('new review')
  })

  it('a_copied_spec_gets_an_id_of_its_own_so_the_original_is_not_taken_for_renamed', async () => {
    await workspace({ 'specs/a.spec.md': spec('A', 'abc'), 'specs/b.spec.md': spec('B', 'abc') })

    const report = await followSpecRenames(dir)

    expect(specIdOf(await text('specs/a.spec.md'))).toBe('abc')
    expect(specIdOf(await text('specs/b.spec.md'))).not.toBe('abc')
    expect(report.renamed).toEqual([])
  })

  it('a_spec_just_written_by_its_planner_is_given_its_id_before_the_next_start', async () => {
    await workspace({ 'specs/audit.spec.md': spec('Audit') })

    await recordSpecId(dir, 'Audit')

    const id = specIdOf(await text('specs/audit.spec.md'))!
    expect(JSON.parse(await text(SPEC_IDS_FILE))).toEqual({ [id]: 'audit' })
  })

  it('a_spec_its_planner_has_not_written_yet_is_left_alone', async () => {
    await workspace({})

    await recordSpecId(dir, 'Audit')

    expect(await exists(SPEC_IDS_FILE)).toBe(false)
  })
})

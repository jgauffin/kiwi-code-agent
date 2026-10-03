import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnfiledContract, migrateUnfiled, parseUnfiled, readUnfiled, splitByBuilt } from '../src/agent/phases/unfiled-decisions'
import { fileDecisionsPrompt } from '../src/agent/phases/file-decisions'
import { withWorkspace } from './workspace-fixture'

const file = `# Unfiled decisions

### Identity provider
- decided: Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.
- affects: Tenants, Invitations, docs
`

const future = `# Future work

### Invitation expiry
- decided: an invitation expires after seven days.
- affects: Invitations
`

/** A file from before future work had one of its own: every entry said whether it was built. */
const beforeTheSplit = `# Unfiled decisions

### Identity provider
- decided: Keycloak owns sign-in.
- affects: Tenants, docs
- built: true

### Invitation expiry
- decided: an invitation expires after seven days.
- affects: Invitations
- built: false
`

describe('unfiled decisions', () => {
  it('an_entry_is_what_the_user_decided_and_which_features_it_reaches', () => {
    const { entries, problems } = parseUnfiled(file)
    expect(problems).toEqual([])
    expect(entries).toEqual([
      {
        title: 'Identity provider',
        decided: 'Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.',
        affects: ['Tenants', 'Invitations', 'docs'],
      },
    ])
  })

  it('a_built_line_is_a_problem_that_names_the_file_work_for_later_goes_in', () => {
    const { problems } = parseUnfiled('### Roles\n- decided: an owner may invite.\n- affects: Tenants\n- built: false\n')
    expect(problems).toEqual([expect.stringMatching(/^line 4: an entry has no built line: .*specs\/future-work\.md/)])
  })

  it('an_entry_without_a_decision_and_a_line_outside_the_shape_are_problems_naming_their_line', () => {
    const { entries, problems } = parseUnfiled('### Roles\n- affects: Tenants\n\nloose prose\n\n### Audit\n- decided: x\n- because: y\n')
    expect(entries.map((e) => e.title)).toEqual(['Roles', 'Audit'])
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/^line 1: "Roles" has no decided line/)
    expect(problems[1]).toMatch(/^line 4: /)
    expect(problems[2]).toMatch(/^line 8: /)
  })

  it('both_files_are_read_and_an_entry_from_the_future_work_file_is_marked_for_later', async () => {
    await withWorkspace({}, async (dir) => {
      expect(await readUnfiled(dir)).toEqual([])
      await mkdir(join(dir, 'specs'))
      await writeFile(join(dir, 'specs', 'unfiled-decisions.md'), file)
      await writeFile(join(dir, 'specs', 'future-work.md'), future)
      expect((await readUnfiled(dir)).map((e) => [e.title, e.later])).toEqual([
        ['Identity provider', false],
        ['Invitation expiry', true],
      ])
    })
  })
})

describe('splitting a file from before future work had its own', () => {
  it('an_entry_still_to_build_moves_out_and_every_built_line_goes', () => {
    const { now, later, changed } = splitByBuilt(beforeTheSplit)
    expect(changed).toBe(true)
    expect(now).toBe('# Unfiled decisions\n\n### Identity provider\n- decided: Keycloak owns sign-in.\n- affects: Tenants, docs\n')
    expect(later).toEqual(['### Invitation expiry\n- decided: an invitation expires after seven days.\n- affects: Invitations'])
  })

  it('a_file_without_built_lines_is_left_alone', () => {
    expect(splitByBuilt(file).changed).toBe(false)
  })

  it('the_split_appends_to_future_work_already_there_and_runs_once', async () => {
    await withWorkspace({ 'specs/unfiled-decisions.md': beforeTheSplit, 'specs/future-work.md': '# Future work\n\n### Audit log\n- decided: x\n- affects: docs\n' }, async (dir) => {
      expect(await migrateUnfiled(dir)).toEqual({ changed: true, moved: 1 })
      const unfiled = parseUnfiled(await readFile(join(dir, 'specs', 'unfiled-decisions.md'), 'utf8'))
      const later = parseUnfiled(await readFile(join(dir, 'specs', 'future-work.md'), 'utf8'))
      expect(unfiled).toEqual({ entries: [expect.objectContaining({ title: 'Identity provider' })], problems: [] })
      expect(later.problems).toEqual([])
      expect(later.entries.map((e) => e.title)).toEqual(['Audit log', 'Invitation expiry'])
      expect(await migrateUnfiled(dir)).toEqual({ changed: false, moved: 0 })
    })
  })

  it('the_future_work_file_is_created_when_there_is_none', async () => {
    await withWorkspace({ 'specs/unfiled-decisions.md': beforeTheSplit }, async (dir) => {
      await migrateUnfiled(dir)
      expect(await readFile(join(dir, 'specs', 'future-work.md'), 'utf8')).toBe(
        '# Future work\n\n### Invitation expiry\n- decided: an invitation expires after seven days.\n- affects: Invitations\n',
      )
    })
  })
})

describe('filing the decisions', () => {
  it('future_work_goes_to_the_docs_and_never_into_a_spec_as_a_rule', () => {
    const prompt = fileDecisionsPrompt('/w')
    expect(prompt).toContain('An entry from `specs/future-work.md` is never written into a spec as a rule')
    expect(prompt).toContain('it is a feature to plan')
    expect(prompt).not.toContain('built:')
  })
})

describe('UnfiledContract hook', () => {
  it('hands_the_problems_back_on_a_write_of_either_file_and_ignores_other_files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'unfiled-contract-'))
    try {
      await mkdir(join(dir, 'specs'))
      const hook = new UnfiledContract(dir)
      const write = (path: string) => hook.postToolUse({ toolName: 'Edit', input: { file_path: path }, toolUseId: 't', output: 'ok', isError: false })
      await writeFile(join(dir, 'specs', 'unfiled-decisions.md'), file)
      expect(await write('specs/unfiled-decisions.md')).toBeUndefined()
      await writeFile(join(dir, 'specs', 'unfiled-decisions.md'), '### Roles\n- affects: Tenants\n')
      const outcome = await write(join(dir, 'specs', 'unfiled-decisions.md'))
      expect(outcome?.additionalContext).toContain('`specs/unfiled-decisions.md` is off shape')
      await writeFile(join(dir, 'specs', 'future-work.md'), '### Audit\n- decided: x\n- built: false\n')
      expect((await write('specs/future-work.md'))?.additionalContext).toContain('`specs/future-work.md` is off shape')
      await writeFile(join(dir, 'specs', 'notes.md'), 'anything\n')
      expect(await write('specs/notes.md')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

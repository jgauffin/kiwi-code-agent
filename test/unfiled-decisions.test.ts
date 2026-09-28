import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnfiledContract, parseUnfiled, readUnfiled } from '../src/agent/phases/unfiled-decisions'

const file = `# Unfiled decisions

### Identity provider
- decided: Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.
- affects: Tenants, Invitations, docs

### Invitation expiry
- decided: an invitation expires after seven days.
- affects: Invitations
`

describe('unfiled decisions', () => {
  it('an_entry_is_what_the_user_decided_and_which_features_it_reaches', () => {
    const { entries, problems } = parseUnfiled(file)
    expect(problems).toEqual([])
    expect(entries.map((e) => [e.title, e.decided, e.affects])).toEqual([
      [
        'Identity provider',
        'Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.',
        ['Tenants', 'Invitations', 'docs'],
      ],
      ['Invitation expiry', 'an invitation expires after seven days.', ['Invitations']],
    ])
  })

  it('an_entry_without_a_decision_and_a_line_outside_the_shape_are_problems_naming_their_line', () => {
    const { entries, problems } = parseUnfiled('### Roles\n- affects: Tenants\n\nloose prose\n\n### Audit\n- decided: x\n- because: y\n')
    expect(entries.map((e) => e.title)).toEqual(['Roles', 'Audit'])
    expect(problems).toHaveLength(3)
    expect(problems[0]).toMatch(/^line 1: "Roles"/)
    expect(problems[1]).toMatch(/^line 4: /)
    expect(problems[2]).toMatch(/^line 8: /)
  })

  it('a_workspace_without_the_file_has_no_unfiled_decisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'unfiled-'))
    try {
      expect(await readUnfiled(dir)).toEqual([])
      await mkdir(join(dir, 'plan'))
      await writeFile(join(dir, 'plan', 'unfiled-decisions.md'), file)
      expect((await readUnfiled(dir)).map((e) => e.title)).toEqual(['Identity provider', 'Invitation expiry'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('UnfiledContract hook', () => {
  it('hands_the_problems_back_on_a_write_of_the_unfiled_file_and_ignores_other_files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'unfiled-contract-'))
    try {
      await mkdir(join(dir, 'plan'))
      const hook = new UnfiledContract(dir)
      const write = (path: string) => hook.postToolUse({ toolName: 'Edit', input: { file_path: path }, toolUseId: 't', output: 'ok', isError: false })
      await writeFile(join(dir, 'plan', 'unfiled-decisions.md'), file)
      expect(await write('plan/unfiled-decisions.md')).toBeUndefined()
      await writeFile(join(dir, 'plan', 'unfiled-decisions.md'), '### Roles\n- affects: Tenants\n')
      const outcome = await write(join(dir, 'plan', 'unfiled-decisions.md'))
      expect(outcome?.additionalContext).toContain('`plan/unfiled-decisions.md` is off shape')
      await writeFile(join(dir, 'plan', 'notes.md'), 'anything\n')
      expect(await write('plan/notes.md')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

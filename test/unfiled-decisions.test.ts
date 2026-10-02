import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UnfiledContract, parseUnfiled, readUnfiled } from '../src/agent/phases/unfiled-decisions'
import { fileDecisionsPrompt } from '../src/agent/phases/file-decisions'

const file = `# Unfiled decisions

### Identity provider
- decided: Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.
- affects: Tenants, Invitations, docs
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
    expect(entries.map((e) => [e.title, e.decided, e.affects, e.built])).toEqual([
      [
        'Identity provider',
        'Keycloak owns sign-in, passwords and invitation acceptance; a tenant is a Keycloak organization.',
        ['Tenants', 'Invitations', 'docs'],
        true,
      ],
      ['Invitation expiry', 'an invitation expires after seven days.', ['Invitations'], false],
    ])
  })

  it('an_entry_that_does_not_say_whether_the_product_already_works_that_way_is_a_problem', () => {
    const entry = '### Roles\n- decided: an owner may invite.\n- affects: Tenants\n'
    expect(parseUnfiled(entry).problems).toEqual([expect.stringMatching(/^line 1: "Roles" has no built line/)])
    expect(parseUnfiled(`${entry}- built: maybe\n`).problems).toEqual([expect.stringMatching(/^line 4: "maybe": built is true or false\./)])
  })

  it('an_entry_without_a_decision_and_a_line_outside_the_shape_are_problems_naming_their_line', () => {
    const { entries, problems } = parseUnfiled('### Roles\n- affects: Tenants\n\nloose prose\n\n### Audit\n- decided: x\n- because: y\n')
    expect(entries.map((e) => e.title)).toEqual(['Roles', 'Audit'])
    expect(problems).toHaveLength(5)
    expect(problems[0]).toMatch(/^line 1: "Roles" has no decided line/)
    expect(problems[1]).toMatch(/^line 1: "Roles" has no built line/)
    expect(problems[2]).toMatch(/^line 4: /)
    expect(problems[3]).toMatch(/^line 6: "Audit" has no built line/)
    expect(problems[4]).toMatch(/^line 8: /)
  })

  it('a_workspace_without_the_file_has_no_unfiled_decisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'unfiled-'))
    try {
      expect(await readUnfiled(dir)).toEqual([])
      await mkdir(join(dir, 'specs'))
      await writeFile(join(dir, 'specs', 'unfiled-decisions.md'), file)
      expect((await readUnfiled(dir)).map((e) => e.title)).toEqual(['Identity provider', 'Invitation expiry'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('filing the decisions', () => {
  it('a_decision_still_to_build_goes_to_the_docs_and_never_into_a_spec_as_a_rule', () => {
    const prompt = fileDecisionsPrompt('/w')
    expect(prompt).toContain('`built: false` is never written into a spec as a rule')
    expect(prompt).toContain('it is a feature to plan')
  })
})

describe('UnfiledContract hook', () => {
  it('hands_the_problems_back_on_a_write_of_the_unfiled_file_and_ignores_other_files', async () => {
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
      await writeFile(join(dir, 'specs', 'notes.md'), 'anything\n')
      expect(await write('specs/notes.md')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

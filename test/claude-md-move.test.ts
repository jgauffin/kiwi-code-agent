import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyMove, claudeMdPath, mergedAgentsText, moveOfferDue, pendingMove } from '../src/agent/instructions/claude-md-move'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'claude-md-move-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'claude-md-move-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

describe('claudeMdPath (project or person scope)', () => {
  it('a_project_scope_claude_md_sits_in_the_workspace', () => {
    expect(claudeMdPath('project', cwd, home)).toBe(join(cwd, 'CLAUDE.md'))
  })

  it('a_person_scope_claude_md_sits_under_their_home_directory', () => {
    expect(claudeMdPath('user', cwd, home)).toBe(join(home, '.claude', 'CLAUDE.md'))
  })
})

describe('content moves whole', () => {
  it('an_empty_agents_md_gets_claude_mds_text_exactly', () => {
    expect(mergedAgentsText('# Rules\n\nReproduce a bug before fixing it.', undefined)).toBe('# Rules\n\nReproduce a bug before fixing it.\n')
  })
})

describe('both files already there', () => {
  it('an_agents_md_that_already_holds_text_keeps_it_and_gets_claude_mds_text_appended_under_a_heading_naming_where_it_came_from', () => {
    const merged = mergedAgentsText('Reproduce a bug before fixing it.', '# Team rules\n\nRefactor towards SOLID.')
    expect(merged.indexOf('# Team rules')).toBeLessThan(merged.indexOf('## Moved from CLAUDE.md'))
    expect(merged).toContain('Refactor towards SOLID.')
    expect(merged.indexOf('## Moved from CLAUDE.md')).toBeLessThan(merged.indexOf('Reproduce a bug before fixing it.'))
  })
})

describe('pendingMove', () => {
  it('a_scope_with_no_claude_md_has_nothing_to_move', async () => {
    expect(await pendingMove('project', cwd, home)).toBeUndefined()
  })

  it('a_claude_md_holding_only_blank_text_has_nothing_to_move', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '   \n', 'utf8')
    expect(await pendingMove('project', cwd, home)).toBeUndefined()
  })

  it('a_project_with_claude_md_and_no_agents_md_yet_is_offered_the_moves_whole_text', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), 'Keep functions small.', 'utf8')
    const move = await pendingMove('project', cwd, home)
    expect(move?.agentsText).toBeUndefined()
    expect(move?.mergedText).toBe('Keep functions small.\n')
    expect(move?.claudePath).toBe(join(cwd, 'CLAUDE.md'))
    expect(move?.agentsPath).toBe(join(cwd, 'AGENTS.md'))
  })

  it('a_person_with_claude_md_is_offered_the_move_into_their_own_agents_md', async () => {
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Name things clearly.', 'utf8')
    const move = await pendingMove('user', cwd, home)
    expect(move?.agentsPath).toBe(join(home, 'AGENTS.md'))
    expect(move?.mergedText).toBe('Name things clearly.\n')
  })
})

describe('offered once per file', () => {
  it('a_scope_with_nothing_to_move_is_never_due', async () => {
    expect(moveOfferDue(await pendingMove('project', cwd, home), false)).toBe(false)
  })

  it('a_scope_with_something_to_move_and_no_prior_decline_is_due', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), 'Reproduce a bug before fixing it.', 'utf8')
    expect(moveOfferDue(await pendingMove('project', cwd, home), false)).toBe(true)
  })

  it('a_declined_offer_is_not_raised_again', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), 'Reproduce a bug before fixing it.', 'utf8')
    expect(moveOfferDue(await pendingMove('project', cwd, home), true)).toBe(false)
  })

  it('the_workspaces_file_and_the_persons_own_are_offered_independently_of_each_other', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), 'Workspace rule.', 'utf8')
    const project = await pendingMove('project', cwd, home)
    const user = await pendingMove('user', cwd, home)
    expect(moveOfferDue(project, false)).toBe(true)
    expect(moveOfferDue(user, false)).toBe(false)
  })
})

describe('confirmed before the file goes', () => {
  it('applying_a_move_writes_the_merged_text_to_agents_md_and_removes_claude_md', async () => {
    await writeFile(join(cwd, 'AGENTS.md'), '# Team rules\n\nRefactor towards SOLID.', 'utf8')
    await writeFile(join(cwd, 'CLAUDE.md'), 'Reproduce a bug before fixing it.', 'utf8')
    const move = await pendingMove('project', cwd, home)
    expect(move).toBeDefined()
    await applyMove(move!)
    const agentsText = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(agentsText).toContain('# Team rules')
    expect(agentsText).toContain('Reproduce a bug before fixing it.')
    await expect(readFile(join(cwd, 'CLAUDE.md'), 'utf8')).rejects.toThrow()
    expect(await pendingMove('project', cwd, home)).toBeUndefined()
  })
})

describe('same rules on both engines after the move', () => {
  it('the_moved_text_sits_in_agents_md_the_one_file_both_engines_already_read', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), 'Say which rule you set aside.', 'utf8')
    const move = await pendingMove('project', cwd, home)
    await applyMove(move!)
    const agentsText = await readFile(join(cwd, 'AGENTS.md'), 'utf8')
    expect(agentsText).toContain('Say which rule you set aside.')
  })
})

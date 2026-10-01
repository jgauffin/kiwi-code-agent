import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MEMORY_CAP,
  MemoryContract,
  enforceUserMemoryCap,
  memoryWritingInstructions,
  projectMemoryDir,
  rebuildProjectIndex,
  userMemoryFile,
} from '../src/agent/memory/memories'

let cwd: string
let home: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'memory-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'memory-home-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

describe('project memory paths', () => {
  it('a_projects_notes_sit_under_the_persons_home_keyed_by_the_checkout_so_they_never_reach_the_repository', () => {
    const dir = projectMemoryDir('d:\\src\\coderr\\CodingAgent', 'C:\\Users\\jonas')
    expect(dir).toBe(join('C:\\Users\\jonas', '.claude', 'projects', 'd--src-coderr-CodingAgent', 'memory'))
  })
})

describe('rebuildProjectIndex', () => {
  it('a_notes_title_and_summary_come_from_the_note_itself_and_the_index_lists_them_oldest_first', async () => {
    const dir = join(cwd, 'memory')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'blue.md'), '# Blue means clickable\n\nNon-interactive UI never uses button/badge/focus blue.\n')
    await setMtime(join(dir, 'blue.md'), 1000)
    await writeFile(join(dir, 'constraints.md'), '# CodingAgent constraints\n\nSDK pinned to 0.2.112.\n')
    await setMtime(join(dir, 'constraints.md'), 2000)
    const { entries, dropped } = await rebuildProjectIndex(dir)
    expect(dropped).toEqual([])
    expect(entries).toEqual([
      { title: 'Blue means clickable', file: 'blue.md', summary: 'Non-interactive UI never uses button/badge/focus blue.' },
      { title: 'CodingAgent constraints', file: 'constraints.md', summary: 'SDK pinned to 0.2.112.' },
    ])
    const index = await readFile(join(dir, 'MEMORY.md'), 'utf8')
    expect(index).toBe(
      '- [Blue means clickable](blue.md) \u2014 Non-interactive UI never uses button/badge/focus blue.\n' +
        '- [CodingAgent constraints](constraints.md) \u2014 SDK pinned to 0.2.112.\n',
    )
  })

  it('a_note_with_no_heading_is_named_after_its_file', async () => {
    const dir = join(cwd, 'memory')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'build-order.md'), 'npm run build before npm test, always.\n')
    const { entries } = await rebuildProjectIndex(dir)
    expect(entries).toEqual([{ title: 'build order', file: 'build-order.md', summary: 'npm run build before npm test, always.' }])
  })

  it('a_note_written_again_under_the_same_name_replaces_the_old_one_instead_of_sitting_beside_it', async () => {
    const dir = join(cwd, 'memory')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'blue.md'), '# Blue means clickable\n\nold wording\n')
    await rebuildProjectIndex(dir)
    await writeFile(join(dir, 'blue.md'), '# Blue means clickable\n\nnew wording\n')
    const { entries } = await rebuildProjectIndex(dir)
    expect(entries).toEqual([{ title: 'Blue means clickable', file: 'blue.md', summary: 'new wording' }])
  })

  it('a_write_past_the_cap_drops_the_oldest_note', async () => {
    const dir = join(cwd, 'memory')
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < MEMORY_CAP + 1; i++) {
      await writeFile(join(dir, `note-${i}.md`), `# Note ${i}\n\nsummary ${i}\n`)
      await setMtime(join(dir, `note-${i}.md`), 1000 + i)
    }
    const { entries, dropped } = await rebuildProjectIndex(dir)
    expect(entries).toHaveLength(MEMORY_CAP)
    expect(dropped).toEqual([{ title: 'Note 0', file: 'note-0.md' }])
    expect(entries.map((e) => e.file)).not.toContain('note-0.md')
  })

  it('a_workspace_with_no_memory_folder_yet_has_no_entries', async () => {
    expect(await rebuildProjectIndex(join(cwd, 'memory'))).toEqual({ entries: [], dropped: [] })
  })
})

describe('enforceUserMemoryCap', () => {
  it('a_file_with_no_memories_section_is_left_alone', () => {
    const text = '# Instructions\n\nSome rules.\n'
    expect(enforceUserMemoryCap(text)).toEqual({ text, dropped: [], changed: false })
  })

  it('a_bullet_written_again_under_the_same_title_replaces_the_earlier_one', () => {
    const text = '# Instructions\n\n## Memories\n\n- **Likes short replies**: say less, not more.\n- **Likes short replies**: three sentences at most.\n'
    const { text: result, dropped, changed } = enforceUserMemoryCap(text)
    expect(changed).toBe(true)
    expect(dropped).toEqual([])
    expect(result).toContain('- **Likes short replies**: three sentences at most.')
    expect(result.match(/Likes short replies/g)).toHaveLength(1)
  })

  it('a_write_past_fifty_drops_the_oldest_bullet_and_says_so', () => {
    const bullets = Array.from({ length: MEMORY_CAP + 1 }, (_, i) => `- **Note ${i}**: text ${i}.`).join('\n')
    const text = `## Memories\n\n${bullets}\n`
    const { dropped, changed, text: result } = enforceUserMemoryCap(text)
    expect(changed).toBe(true)
    expect(dropped).toEqual(['Note 0'])
    expect(result).not.toContain('Note 0')
    expect(result).toContain('Note 1')
  })

  it('a_section_already_within_shape_is_reported_unchanged', () => {
    const text = '## Memories\n\n- **Likes short replies**: say less, not more.\n'
    expect(enforceUserMemoryCap(text)).toEqual({ text, dropped: [], changed: false })
  })
})

describe('MemoryContract hook', () => {
  it('writing_a_project_note_rebuilds_the_index_and_names_the_memory_and_its_scope_in_the_chat_line', async () => {
    const dir = projectMemoryDir(cwd, home)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'blue.md')
    await writeFile(path, '# Blue means clickable\n\nNon-interactive UI never uses button/badge/focus blue.\n')
    const hook = new MemoryContract(cwd, home)
    const outcome = await hook.postToolUse({ toolName: 'Write', input: { file_path: path }, toolUseId: 't', output: 'ok', isError: false })
    expect(outcome?.additionalContext).toContain('Noted for project: Blue means clickable.')
    expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toContain('[Blue means clickable](blue.md)')
  })

  it('a_write_elsewhere_in_the_workspace_is_not_a_memory', async () => {
    const hook = new MemoryContract(cwd, home)
    const path = join(cwd, 'src', 'index.ts')
    await mkdir(join(cwd, 'src'), { recursive: true })
    await writeFile(path, 'export {}\n')
    expect(await hook.postToolUse({ toolName: 'Write', input: { file_path: path }, toolUseId: 't', output: 'ok', isError: false })).toBeUndefined()
  })

  it('a_failed_write_is_never_taken_as_a_memory', async () => {
    const hook = new MemoryContract(cwd, home)
    const dir = projectMemoryDir(cwd, home)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'blue.md')
    expect(await hook.postToolUse({ toolName: 'Write', input: { file_path: path }, toolUseId: 't', output: 'denied', isError: true })).toBeUndefined()
  })

  it('a_project_write_past_the_cap_says_which_note_was_dropped', async () => {
    const dir = projectMemoryDir(cwd, home)
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < MEMORY_CAP; i++) {
      await writeFile(join(dir, `note-${i}.md`), `# Note ${i}\n\nsummary ${i}\n`)
      await setMtime(join(dir, `note-${i}.md`), 1000 + i)
    }
    const hook = new MemoryContract(cwd, home)
    const path = join(dir, 'note-last.md')
    await writeFile(path, '# Note last\n\nsummary last\n')
    const outcome = await hook.postToolUse({ toolName: 'Write', input: { file_path: path }, toolUseId: 't', output: 'ok', isError: false })
    expect(outcome?.additionalContext).toContain('Noted for project: Note last.')
    expect(outcome?.additionalContext).toContain('"Note 0"')
    expect(outcome?.additionalContext).toContain('dropped to make room')
  })

  it('a_bullet_written_into_the_users_memory_file_is_noted_for_the_user', async () => {
    const path = userMemoryFile(home)
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(path, '## Memories\n\n- **Likes short replies**: say less, not more.\n')
    const hook = new MemoryContract(cwd, home)
    const outcome = await hook.postToolUse({
      toolName: 'Edit',
      input: { file_path: path, old_string: 'x', new_string: '- **Likes short replies**: say less, not more.' },
      toolUseId: 't',
      output: 'ok',
      isError: false,
    })
    expect(outcome?.additionalContext).toContain('Noted for user: Likes short replies.')
  })

  it('an_edit_of_the_users_file_outside_the_memories_section_is_not_a_memory', async () => {
    const path = userMemoryFile(home)
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(path, '# Instructions\n\nSome rules.\n')
    const hook = new MemoryContract(cwd, home)
    const outcome = await hook.postToolUse({
      toolName: 'Edit',
      input: { file_path: path, old_string: 'Some rules.', new_string: 'Some other rules.' },
      toolUseId: 't',
      output: 'ok',
      isError: false,
    })
    expect(outcome).toBeUndefined()
  })
})

describe('memoryWritingInstructions', () => {
  it('names_both_scopes_own_file_and_the_chat_line_the_person_sees', () => {
    const text = memoryWritingInstructions(cwd, home)
    expect(text).toContain(projectMemoryDir(cwd, home))
    expect(text).toContain(userMemoryFile(home))
    expect(text).toContain('Say so in the chat')
    expect(text).toContain('fifty')
  })

  it('tells_a_single_use_fact_apart_from_what_is_worth_remembering', () => {
    expect(memoryWritingInstructions(cwd, home)).toContain('a value you just worked out or the file you are about to edit is a single-use fact, not a memory')
  })

  it('lets_the_person_name_the_scope_instead_of_the_agent_guessing', () => {
    expect(memoryWritingInstructions(cwd, home)).toContain('When the person names the scope, use that one, not your own guess')
  })

  it('sends_product_intent_to_the_unfiled_decisions_and_a_team_wide_note_to_the_docs_instead_of_a_memory', () => {
    const text = memoryWritingInstructions(cwd, home)
    expect(text).toContain('something that says what the product does belongs with the unfiled decisions instead')
    expect(text).toContain('A note the whole team should follow, not just you working here, is offered as a docs change instead')
  })
})

async function setMtime(path: string, ms: number): Promise<void> {
  const date = new Date(ms)
  await utimes(path, date, date)
}

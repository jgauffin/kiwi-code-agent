import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { readTool } from '../src/agent/openai-session/tools/read'
import { writeTool } from '../src/agent/openai-session/tools/write'
import { editTool } from '../src/agent/openai-session/tools/edit'
import { copyTool, moveTool } from '../src/agent/openai-session/tools/move-copy'
import { globTool } from '../src/agent/openai-session/tools/glob'
import { grepTool } from '../src/agent/openai-session/tools/grep'
import { bashTool } from '../src/agent/openai-session/tools/bash'
import { askUserSchema, askUserTool } from '../src/agent/openai-session/tools/ask-user'
import { toDefinition, type ToolContext } from '../src/agent/openai-session/tools/tool'

let dir: string
let ctx: ToolContext

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tools-'))
  ctx = { cwd: dir, signal: new AbortController().signal, files: new ReadTracker() }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('Read', () => {
  it('numbers_lines_and_honours_offset_and_limit', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour')
    const all = await readTool.execute({ file_path: 'a.txt' }, ctx)
    expect(all.text).toBe('1\tone\n2\ttwo\n3\tthree\n4\tfour')
    const part = await readTool.execute({ file_path: 'a.txt', offset: 2, limit: 2 }, ctx)
    expect(part.text).toBe('2\ttwo\n3\tthree')
  })

  it('missing_file_is_a_tool_error_not_an_exception', async () => {
    const result = await readTool.execute({ file_path: 'nope.txt' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('nope.txt')
  })
})

describe('Edit', () => {
  it('refuses_a_file_that_was_never_read', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello')
    const result = await editTool.execute({ file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not been read')
  })

  it('refuses_a_file_changed_on_disk_since_it_was_read', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'hello')
    await readTool.execute({ file_path: 'a.txt' }, ctx)
    await writeFile(path, 'hello world')
    const later = new Date(Date.now() + 5000)
    await utimes(path, later, later)
    const result = await editTool.execute({ file_path: 'a.txt', old_string: 'hello', new_string: 'bye' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('changed on disk')
  })

  it('replaces_a_unique_match_and_demands_replace_all_for_repeats', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'a b a')
    await readTool.execute({ file_path: 'a.txt' }, ctx)
    const ambiguous = await editTool.execute({ file_path: 'a.txt', old_string: 'a', new_string: 'x' }, ctx)
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain('2 times')
    const unique = await editTool.execute({ file_path: 'a.txt', old_string: 'b', new_string: 'y' }, ctx)
    expect(unique.isError).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('a y a')
    const all = await editTool.execute({ file_path: 'a.txt', old_string: 'a', new_string: 'x', replace_all: true }, ctx)
    expect(all.isError).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('x y x')
  })

  it('an_edit_counts_as_a_read_so_the_next_edit_is_allowed', async () => {
    const path = join(dir, 'a.txt')
    await writeFile(path, 'one')
    await readTool.execute({ file_path: 'a.txt' }, ctx)
    await editTool.execute({ file_path: 'a.txt', old_string: 'one', new_string: 'two' }, ctx)
    const again = await editTool.execute({ file_path: 'a.txt', old_string: 'two', new_string: 'three' }, ctx)
    expect(again.isError).toBe(false)
  })
})

describe('Write', () => {
  it('creates_missing_directories_for_a_new_file', async () => {
    const result = await writeTool.execute({ file_path: 'deep/er/new.txt', content: 'x' }, ctx)
    expect(result.isError).toBe(false)
    expect(await readFile(join(dir, 'deep/er/new.txt'), 'utf8')).toBe('x')
  })

  it('refuses_to_overwrite_an_unread_existing_file', async () => {
    await writeFile(join(dir, 'a.txt'), 'keep')
    const result = await writeTool.execute({ file_path: 'a.txt', content: 'lost' }, ctx)
    expect(result.isError).toBe(true)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('keep')
  })
})

describe('Move and Copy', () => {
  it('move_relocates_a_file_creating_missing_directories', async () => {
    await writeFile(join(dir, 'a.txt'), 'x')
    const result = await moveTool.execute({ source: 'a.txt', destination: 'deep/b.txt' }, ctx)
    expect(result.isError).toBe(false)
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
    expect(await readFile(join(dir, 'deep/b.txt'), 'utf8')).toBe('x')
  })

  it('copy_duplicates_a_folder_and_leaves_the_original', async () => {
    await mkdir(join(dir, 'src/sub'), { recursive: true })
    await writeFile(join(dir, 'src/sub/a.txt'), 'x')
    const result = await copyTool.execute({ source: 'src', destination: 'lib' }, ctx)
    expect(result.isError).toBe(false)
    expect(await readFile(join(dir, 'src/sub/a.txt'), 'utf8')).toBe('x')
    expect(await readFile(join(dir, 'lib/sub/a.txt'), 'utf8')).toBe('x')
  })

  it('neither_overwrites_an_existing_destination', async () => {
    await writeFile(join(dir, 'a.txt'), 'new')
    await writeFile(join(dir, 'b.txt'), 'keep')
    for (const tool of [moveTool, copyTool]) {
      const result = await tool.execute({ source: 'a.txt', destination: 'b.txt' }, ctx)
      expect(result.isError, tool.name).toBe(true)
      expect(result.text).toContain('already exists')
    }
    expect(await readFile(join(dir, 'b.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('new')
  })

  it('a_missing_source_is_a_tool_error', async () => {
    const result = await moveTool.execute({ source: 'nope.txt', destination: 'b.txt' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('nope.txt')
  })

  it('a_moved_file_must_be_read_again_before_it_is_edited', async () => {
    await writeFile(join(dir, 'a.txt'), 'x')
    await readTool.execute({ file_path: 'a.txt' }, ctx)
    await moveTool.execute({ source: 'a.txt', destination: 'b.txt' }, ctx)
    const result = await editTool.execute({ file_path: 'b.txt', old_string: 'x', new_string: 'y' }, ctx)
    expect(result.text).toContain('not been read')
  })
})

describe('Glob and Grep', () => {
  beforeEach(async () => {
    await mkdir(join(dir, 'src', 'sub'), { recursive: true })
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.ts'), 'export const answer = 42\n')
    await writeFile(join(dir, 'src', 'sub', 'b.ts'), 'const question = "unknown"\nconst Answer = 1\n')
    await writeFile(join(dir, 'src', 'c.md'), 'answer in prose\n')
    await writeFile(join(dir, 'node_modules', 'dep', 'index.ts'), 'const answer = 0\n')
  })

  it('glob_finds_files_and_skips_dependency_folders', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts' }, ctx)
    expect(result.text).toContain(join(dir, 'src', 'a.ts'))
    expect(result.text).toContain(join(dir, 'src', 'sub', 'b.ts'))
    expect(result.text).not.toContain('node_modules')
  })

  it('grep_reports_file_line_and_text_and_filters_by_include', async () => {
    const result = await grepTool.execute({ pattern: 'answer', include: '*.ts' }, ctx)
    expect(result.text).toBe(`${join('src', 'a.ts')}:1:export const answer = 42`)
  })

  it('grep_case_insensitive_and_files_only_mode', async () => {
    const result = await grepTool.execute({ pattern: 'answer', case_insensitive: true, output_mode: 'files_with_matches' }, ctx)
    expect(result.text.split('\n').sort()).toEqual([join('src', 'a.ts'), join('src', 'c.md'), join('src', 'sub', 'b.ts')])
  })

  it('grep_rejects_an_invalid_regex_as_a_tool_error', async () => {
    const result = await grepTool.execute({ pattern: '(' }, ctx)
    expect(result.isError).toBe(true)
  })
})

describe('Bash', () => {
  it('returns_output_and_marks_non_zero_exit_as_error', async () => {
    const tool = bashTool()
    const ok = await tool.execute({ command: 'echo hi && echo err 1>&2' }, ctx)
    expect(ok.isError).toBe(false)
    expect(ok.text).toContain('hi')
    expect(ok.text).toContain('err')
    const bad = await tool.execute({ command: 'exit 3' }, ctx)
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('exit code 3')
  })

  it('times_out_a_command_that_never_ends', async () => {
    const result = await bashTool().execute({ command: 'sleep 30', timeout_ms: 1000 }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('timed out')
  })

  it('missing_shell_is_a_tool_error', async () => {
    const result = await bashTool('/no/such/bash').execute({ command: 'echo hi' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Cannot run bash')
  })
})

describe('tool definitions', () => {
  it('json_schema_has_no_schema_url_and_marks_required_fields', () => {
    const def = toDefinition(editTool)
    expect(def.name).toBe('Edit')
    expect(def.parameters).not.toHaveProperty('$schema')
    expect(def.parameters['required']).toEqual(['file_path', 'old_string', 'new_string'])
  })
})

describe('AskUser', () => {
  const card = {
    questions: [
      { header: 'Scope', question: 'How far does this go?', options: [{ label: 'This feature', explanation: 'Nothing else changes.' }, { label: 'Everywhere' }] },
      { header: 'Engines', question: 'Which engines?', options: [{ label: 'Claude' }, { label: 'GLM' }], multiSelect: true },
      { header: 'Name', question: 'What should it be called?' },
    ],
  }

  it('one_tool_of_one_name_and_one_request_shape_serves_every_engine', () => {
    expect(askUserTool.name).toBe('AskUser')
    const def = toDefinition(askUserTool)
    // Both engines are handed this same definition: the SDK one from the schema's shape, the own loop from the JSON schema.
    expect(def.parameters['required']).toEqual(['questions'])
    expect(Object.keys(askUserSchema.shape)).toEqual(['questions'])
    expect(askUserSchema.safeParse(card).success).toBe(true)
    expect(askUserSchema.safeParse({ questions: [] }).success).toBe(false)
  })

  it('a_question_carries_a_header_text_options_with_explanations_and_a_single_or_multi_flag', () => {
    const parsed = askUserSchema.parse(card)
    expect(parsed.questions[0]).toEqual({
      header: 'Scope',
      question: 'How far does this go?',
      options: [{ label: 'This feature', explanation: 'Nothing else changes.' }, { label: 'Everywhere' }],
    })
    expect(parsed.questions[1]!.multiSelect).toBe(true)
    expect(parsed.questions[2]!.options).toBeUndefined()
    expect(askUserSchema.safeParse({ questions: [{ header: 'x' }] }).success).toBe(false)
  })

  it('the_tool_waits_for_the_card_and_returns_the_chosen_options_and_free_text_as_its_result', async () => {
    let asked: unknown
    const answered = await askUserTool.execute(card, {
      ...ctx,
      ask: async (request) => {
        asked = request
        return { kind: 'answered', answers: [{ chosen: ['Everywhere'] }, { chosen: ['Claude', 'GLM'] }, { chosen: [], other: 'AskUser' }] }
      },
    })
    expect(asked).toEqual(card)
    expect(answered.isError).toBe(false)
    expect(answered.text).toContain('Chose: Everywhere')
    expect(answered.text).toContain('Chose: Claude, GLM')
    expect(answered.text).toContain("Other (the user's own words): AskUser")
  })

  it('an_unanswered_question_comes_back_as_no_answer_and_a_session_without_a_user_is_told_so', async () => {
    const declined = await askUserTool.execute(card, { ...ctx, ask: async () => ({ kind: 'unanswered' }) })
    expect(declined.text).toContain('did not answer')
    expect(declined.text).toContain('none may be assumed')
    const nobody = await askUserTool.execute(card, ctx)
    expect(nobody.isError).toBe(true)
    expect(nobody.text).toContain('nobody to ask')
  })
})

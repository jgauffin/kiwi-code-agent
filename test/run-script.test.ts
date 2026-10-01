import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runScriptTool } from '../src/agent/openai-session/tools/run-script'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { ok, truncate, type ToolContext, type ToolOutput } from '../src/agent/openai-session/tools/tool'

type Call = { name: string; input: unknown }

async function context(overrides: Partial<ToolContext> = {}): Promise<{ ctx: ToolContext; calls: Call[]; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'run-script-'))
  const calls: Call[] = []
  const ctx: ToolContext = {
    cwd: dir,
    signal: new AbortController().signal,
    files: new ReadTracker(),
    call: async (name, input): Promise<ToolOutput> => {
      calls.push({ name, input })
      return ok(`${name} output`)
    },
    authorize: async () => undefined,
    confirm: async () => undefined,
    ...overrides,
  }
  return { ctx, calls, dir }
}

describe('RunScript', () => {
  it('reads_a_file_in_full_and_returns_what_the_script_returns', async () => {
    const { ctx, dir } = await context()
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
    const result = await runScriptTool().execute({ script: 'const t = await read("a.txt"); return t.split("\\n").length' }, ctx)
    expect(result).toEqual({ text: '3', isError: false })
  })

  it('refuses_a_read_the_permission_gate_refuses', async () => {
    const { ctx, dir } = await context({ authorize: async () => 'Blocked: secrets' })
    await writeFile(join(dir, 'a.txt'), 'x')
    const result = await runScriptTool().execute({ script: 'return await read("a.txt")' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Blocked: secrets')
  })

  describe('looking about the file system', () => {
    it('lists_a_directory_with_its_subdirectories_marked', async () => {
      const { ctx, dir } = await context()
      await mkdir(join(dir, 'runs'))
      await writeFile(join(dir, 'b.txt'), 'x')
      await writeFile(join(dir, 'a.txt'), 'x')
      const result = await runScriptTool().execute({ script: 'return (await readdir(".")).join(",")' }, ctx)
      expect(result.text).toBe('a.txt,b.txt,runs/')
    })

    it('reports_what_is_there_and_what_is_not', async () => {
      const { ctx, dir } = await context()
      await writeFile(join(dir, 'a.txt'), 'x')
      const result = await runScriptTool().execute({ script: 'return [await exists("a.txt"), await exists("nope.txt")].join(",")' }, ctx)
      expect(result.text).toBe('true,false')
    })

    it('counts_a_file_the_script_has_staged_as_being_there', async () => {
      const { ctx } = await context({ review: async () => ({ kind: 'deny' }) })
      const result = await runScriptTool().execute({ script: 'await write("new.ts", "x"); return await exists("new.ts")' }, ctx)
      expect(result.text).toContain('true')
    })

    it('puts_each_look_to_the_gate_that_may_ask_the_user', async () => {
      const asked: Call[] = []
      const { ctx } = await context({
        confirm: async (name, input) => {
          asked.push({ name, input })
          return undefined
        },
      })
      await runScriptTool().execute({ script: 'await readdir("."); await exists("a.txt")' }, ctx)
      expect(asked).toEqual([
        { name: 'ReadDir', input: { path: '.' } },
        { name: 'Exists', input: { path: 'a.txt' } },
      ])
    })

    it('fails_a_look_the_user_declines', async () => {
      const { ctx } = await context({ confirm: async () => 'Denied by user' })
      const result = await runScriptTool().execute({ script: 'try { await readdir("../..") } catch (e) { return e.message }' }, ctx)
      expect(result.text).toBe('Denied by user')
    })
  })

  it('runs_other_tools_through_the_sessions_own_dispatch', async () => {
    const { ctx, calls } = await context()
    const result = await runScriptTool().execute({ script: 'return await jsonQuery({ file_path: "a.json", expr: "$" })' }, ctx)
    expect(calls).toEqual([{ name: 'JsonQuery', input: { file_path: 'a.json', expr: '$' } }])
    expect(result.text).toBe('JsonQuery output')
  })

  it('a_script_runs_no_shell_commands_so_it_never_floods_the_user_with_prompts', async () => {
    const { ctx, calls } = await context()
    const result = await runScriptTool().execute({ script: 'return typeof bash' }, ctx)
    expect(result.text).toBe('undefined')
    expect(calls).toEqual([])
  })

  it('glob_gives_a_script_every_path_as_an_array', async () => {
    const paths = Array.from({ length: 3000 }, (_, i) => `src/module-with-a-long-name-${i}.ts`)
    const { ctx } = await context({ call: async () => ok(truncate(paths.join('\n')), paths) })
    const result = await runScriptTool().execute({ script: 'const files = await glob({ pattern: "src/**/*.ts" }); return files.length' }, ctx)
    expect(result.text).toBe('3000')
  })

  it('no_match_gives_an_empty_array_not_a_sentence', async () => {
    const { ctx } = await context({ call: async () => ok('No files matched.', []) })
    const result = await runScriptTool().execute({ script: 'return (await glob({ pattern: "*.cs" })).length' }, ctx)
    expect(result.text).toBe('0')
  })

  it('lets_a_script_catch_a_denied_tool_call', async () => {
    const { ctx } = await context({ call: async () => ({ text: 'Denied by user', isError: true }) })
    const result = await runScriptTool().execute({ script: 'try { await grep({ pattern: "x" }) } catch (e) { return "caught: " + e.message }' }, ctx)
    expect(result.text).toBe('caught: Denied by user')
  })

  it('reports_console_output_before_the_result', async () => {
    const { ctx } = await context()
    const result = await runScriptTool().execute({ script: 'console.log("hello"); return 1' }, ctx)
    expect(result.text).toBe('hello\n1')
  })

  describe('staged changes', () => {
    it('writes_nothing_until_the_user_approves_all_changes_together', async () => {
      const reviews: string[][] = []
      const { ctx, dir } = await context({
        review: async (_title, edits) => {
          reviews.push(edits.map((e) => e.label))
          return { kind: 'allow' }
        },
      })
      await writeFile(join(dir, 'a.ts'), 'let foo = 1\n')
      await writeFile(join(dir, 'b.ts'), 'foo()\nfoo()\n')
      const script = 'for (const f of ["a.ts", "b.ts"]) await replace(f, "foo", "bar")'
      const result = await runScriptTool().execute({ script }, ctx)
      expect(reviews).toEqual([['a.ts', 'b.ts']])
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('let bar = 1\n')
      expect(await readFile(join(dir, 'b.ts'), 'utf8')).toBe('bar()\nbar()\n')
    })

    it('leaves_every_file_untouched_when_the_user_declines', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny' }) })
      await writeFile(join(dir, 'a.ts'), 'foo')
      const result = await runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar")' }, ctx)
      expect(result.isError).toBe(true)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('foo')
    })

    it('tells_the_model_why_the_user_declined_the_changes', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny', message: 'rename it in b.ts too' }) })
      await writeFile(join(dir, 'a.ts'), 'foo')
      const result = await runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar")' }, ctx)
      expect(result.text).toContain('rename it in b.ts too')
    })

    it('lets_a_later_read_see_what_the_script_staged_earlier', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny' }) })
      await writeFile(join(dir, 'a.ts'), 'one')
      const script = 'await write("a.ts", "two"); return await read("a.ts")'
      const result = await runScriptTool().execute({ script }, ctx)
      expect(result.text).toContain('two')
    })

    it('reports_how_many_matches_a_replace_found_without_asking_when_nothing_changes', async () => {
      const { ctx, dir } = await context({ review: async () => { throw new Error('should not ask') } })
      await writeFile(join(dir, 'a.ts'), 'x')
      const result = await runScriptTool().execute({ script: 'return await replace("a.ts", "zzz", "y")' }, ctx)
      expect(JSON.parse(result.text)).toEqual({ path: 'a.ts', matches: 0, changed: false })
    })

    it('supports_capture_groups_in_a_regex_replace', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'allow' }) })
      await writeFile(join(dir, 'a.ts'), 'get(1) get(2)')
      await runScriptTool().execute({ script: 'await replace("a.ts", "get\\\\((\\\\d)\\\\)", "fetch($1)")' }, ctx)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('fetch(1) fetch(2)')
    })

    it('previews_the_staged_diff_to_the_script_before_anything_is_applied', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny' }) })
      await writeFile(join(dir, 'a.ts'), 'foo\n')
      const result = await runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar"); return preview()' }, ctx)
      expect(result.text).toContain('--- a.ts')
      expect(result.text).toContain('-foo')
      expect(result.text).toContain('+bar')
    })

    it('refuses_to_stage_a_write_a_deny_rule_forbids', async () => {
      const { ctx } = await context({ authorize: async (name) => (name === 'Write' ? 'Blocked: no writes' : undefined), review: async () => ({ kind: 'allow' }) })
      const result = await runScriptTool().execute({ script: 'try { await write("a.ts", "x") } catch (e) { return e.message }' }, ctx)
      expect(result.text).toContain('Blocked: no writes')
    })

    it('a_move_reaches_the_user_as_the_destination_created_and_the_source_removed', async () => {
      const reviews: string[][] = []
      const { ctx, dir } = await context({
        review: async (_title, edits) => {
          reviews.push(edits.map((e) => (e.summary ? e.summary : e.label)))
          return { kind: 'allow' }
        },
      })
      await writeFile(join(dir, 'old.ts'), 'x\n')
      await runScriptTool().execute({ script: 'await move("old.ts", "src/new.ts")' }, ctx)
      expect(reviews).toEqual([['src/new.ts', 'old.ts: removed']])
      expect(await readFile(join(dir, 'src', 'new.ts'), 'utf8')).toBe('x\n')
      expect(existsSync(join(dir, 'old.ts'))).toBe(false)
    })

    it('a_declined_move_leaves_both_ends_as_they_were', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny' }) })
      await writeFile(join(dir, 'old.ts'), 'x')
      await runScriptTool().execute({ script: 'await move("old.ts", "new.ts")' }, ctx)
      expect(existsSync(join(dir, 'old.ts'))).toBe(true)
      expect(existsSync(join(dir, 'new.ts'))).toBe(false)
    })

    it('a_removed_file_reads_as_gone_for_the_rest_of_the_script', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'deny' }) })
      await writeFile(join(dir, 'a.ts'), 'x')
      const script = 'await remove("a.ts"); const there = await exists("a.ts"); try { await read("a.ts") } catch (e) { return [there, e.message] }'
      const result = await runScriptTool().execute({ script }, ctx)
      expect(JSON.parse(result.text.split('\n').slice(0, -1).join('\n'))).toEqual([false, 'a.ts does not exist: the script removed it'])
    })

    it('a_file_created_and_removed_within_the_script_is_not_put_to_the_user', async () => {
      const { ctx } = await context({ review: async () => { throw new Error('should not ask') } })
      const result = await runScriptTool().execute({ script: 'await write("tmp.ts", "x"); await remove("tmp.ts"); return "done"' }, ctx)
      expect(result).toEqual({ text: 'done', isError: false })
    })

    it('a_copy_never_overwrites_its_destination', async () => {
      const { ctx, dir } = await context()
      await writeFile(join(dir, 'a.ts'), 'a')
      await writeFile(join(dir, 'b.ts'), 'b')
      const result = await runScriptTool().execute({ script: 'try { await copy("a.ts", "b.ts") } catch (e) { return e.message }' }, ctx)
      expect(result.text).toBe('Destination already exists: b.ts')
    })

    it('a_folder_is_moved_file_by_file_or_with_the_Move_tool', async () => {
      const { ctx, dir } = await context()
      await mkdir(join(dir, 'pkg'))
      const result = await runScriptTool().execute({ script: 'try { await move("pkg", "lib") } catch (e) { return e.message }' }, ctx)
      expect(result.text).toContain('use the Move tool')
    })

    it('fails_an_edit_whose_text_is_ambiguous', async () => {
      const { ctx, dir } = await context({ review: async () => ({ kind: 'allow' }) })
      await writeFile(join(dir, 'a.ts'), 'x x')
      const script = 'try { await edit({ file_path: "a.ts", old_string: "x", new_string: "y" }) } catch (e) { return e.message }'
      const result = await runScriptTool().execute({ script }, ctx)
      expect(result.text).toContain('occurs 2 times')
    })
  })

  it('reports_a_failing_script_as_an_error', async () => {
    const { ctx } = await context()
    const result = await runScriptTool().execute({ script: 'throw new Error("nope")' }, ctx)
    expect(result).toEqual({ text: 'Script failed: Error: nope', isError: true })
  })
})

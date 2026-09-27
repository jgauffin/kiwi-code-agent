import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runScriptTool } from '../src/agent/openai-session/tools/run-script'
import { ReadTracker } from '../src/agent/openai-session/tools/read-tracker'
import { ok, type ToolContext, type ToolOutput } from '../src/agent/openai-session/tools/tool'

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

  it('runs_other_tools_through_the_sessions_own_dispatch', async () => {
    const { ctx, calls } = await context()
    const result = await runScriptTool().execute({ script: 'return await bash({ command: "npm test" })' }, ctx)
    expect(calls).toEqual([{ name: 'Bash', input: { command: 'npm test' } }])
    expect(result.text).toBe('Bash output')
  })

  it('lets_a_script_catch_a_denied_tool_call', async () => {
    const { ctx } = await context({ call: async () => ({ text: 'Denied by user', isError: true }) })
    const result = await runScriptTool().execute({ script: 'try { await bash({ command: "x" }) } catch (e) { return "caught: " + e.message }' }, ctx)
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
          return true
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
      const { ctx, dir } = await context({ review: async () => false })
      await writeFile(join(dir, 'a.ts'), 'foo')
      const result = await runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar")' }, ctx)
      expect(result.isError).toBe(true)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('foo')
    })

    it('lets_a_later_read_see_what_the_script_staged_earlier', async () => {
      const { ctx, dir } = await context({ review: async () => false })
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
      const { ctx, dir } = await context({ review: async () => true })
      await writeFile(join(dir, 'a.ts'), 'get(1) get(2)')
      await runScriptTool().execute({ script: 'await replace("a.ts", "get\\\\((\\\\d)\\\\)", "fetch($1)")' }, ctx)
      expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe('fetch(1) fetch(2)')
    })

    it('previews_the_staged_diff_to_the_script_before_anything_is_applied', async () => {
      const { ctx, dir } = await context({ review: async () => false })
      await writeFile(join(dir, 'a.ts'), 'foo\n')
      const result = await runScriptTool().execute({ script: 'await replace("a.ts", "foo", "bar"); return preview()' }, ctx)
      expect(result.text).toContain('--- a.ts')
      expect(result.text).toContain('-foo')
      expect(result.text).toContain('+bar')
    })

    it('refuses_to_stage_a_write_a_deny_rule_forbids', async () => {
      const { ctx } = await context({ authorize: async (name) => (name === 'Write' ? 'Blocked: no writes' : undefined), review: async () => true })
      const result = await runScriptTool().execute({ script: 'try { await write("a.ts", "x") } catch (e) { return e.message }' }, ctx)
      expect(result.text).toContain('Blocked: no writes')
    })

    it('fails_an_edit_whose_text_is_ambiguous', async () => {
      const { ctx, dir } = await context({ review: async () => true })
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createServer as createTcp, type Server as TcpServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackgroundCommands } from '../src/agent/background/background-commands'
import { BACKGROUND_TOOLS, backgroundTools } from '../src/agent/background/background-tools'
import { BACKGROUND_WAIT_TOOL, backgroundWaitTool, MAX_WAIT_SECONDS } from '../src/agent/background/wait-tool'
import type { ToolContext } from '../src/agent/openai-session/tools/tool'
import { judgeCall, type CallContext } from '../src/agent/permissions/judge-call'

let dir: string
let commands: BackgroundCommands
let abort: AbortController
const wait = backgroundWaitTool('s1', undefined as never)
let tool = wait

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bgw-'))
  commands = new BackgroundCommands(dir, () => undefined)
  abort = new AbortController()
  tool = backgroundWaitTool('s1', commands, { pollMs: 20, attemptMs: 300 })
})

afterEach(async () => {
  commands.cutAll()
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

const ctx = () => ({ cwd: dir, signal: abort.signal }) as ToolContext
const run = (input: Record<string, unknown>) => tool.execute(input as never, ctx())

describe('waiting for a condition', () => {
  it('a_wait_on_a_background_commands_exit_returns_as_soon_as_it_exits', async () => {
    const { id } = commands.start('s1', 'sleep 0.3; echo finished; exit 2', 'x', dir)
    const started = Date.now()
    const result = await run({ until: 'exit', id })
    expect(result.text).toContain('exit code 2')
    expect(result.text).toContain('finished')
    expect(Date.now() - started).toBeLessThan(5000)
    // The wait told it, so the session is not told again.
    expect(commands.hasEnded('s1')).toBe(false)
  })

  it('a_wait_for_a_condition_that_already_holds_returns_at_once', async () => {
    await writeFile(join(dir, 'there.txt'), 'x')
    const started = Date.now()
    const result = await run({ until: 'file', path: 'there.txt', timeoutSeconds: 30 })
    expect(result.text).toContain('exists')
    expect(Date.now() - started).toBeLessThan(500)
    const { id } = commands.start('s1', 'echo ready; sleep 30', 'x', dir)
    await run({ until: 'output', id, pattern: 'ready', timeoutSeconds: 30 })
    const again = await run({ until: 'output', id, pattern: 'ready', timeoutSeconds: 30 })
    expect(again.text).toContain('ready')
  })

  it('a_wait_offers_a_command_exit_an_output_pattern_a_url_a_port_and_a_file_that_exists_changes_or_is_gone', async () => {
    const offered = (tool.schema.shape.until as { options: string[] }).options
    expect(offered).toEqual(['exit', 'output', 'url', 'port', 'file'])
    expect((tool.schema.shape.change as { unwrap(): { options: string[] } }).unwrap().options).toEqual(['exists', 'changes', 'gone'])

    const { id } = commands.start('s1', 'sleep 0.3; echo up; sleep 30', 'x', dir)
    expect((await run({ until: 'output', id, pattern: '^up$' })).text).toContain('printed a matching line:\nup')

    const http: Server = createServer((_, res) => res.writeHead(404).end())
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
    const tcp: TcpServer = createTcp()
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r))
    try {
      const httpPort = (http.address() as { port: number }).port
      // Any HTTP response answers, an error status included.
      expect((await run({ until: 'url', url: `http://127.0.0.1:${httpPort}/` })).text).toContain('HTTP 404')
      expect((await run({ until: 'port', host: '127.0.0.1', port: (tcp.address() as { port: number }).port })).text).toContain('accepts connections')
    } finally {
      http.close()
      tcp.close()
    }

    await writeFile(join(dir, 'w.txt'), 'one')
    const changed = run({ until: 'file', path: 'w.txt', change: 'changes' })
    setTimeout(() => void writeFile(join(dir, 'w.txt'), 'two, longer'), 100)
    expect((await changed).text).toContain('changed')
    const gone = await run({ until: 'file', path: 'missing.txt', change: 'gone' })
    expect(gone.text).toContain('is gone')
  })

  it('a_wait_for_a_pattern_returns_at_once_when_the_command_exits_without_printing_it_saying_how_it_ended', async () => {
    const { id } = commands.start('s1', 'echo something else; exit 4', 'x', dir)
    const result = await run({ until: 'output', id, pattern: 'never printed', timeoutSeconds: 30 })
    expect(result.text).toContain('ended with exit code 4 without printing a line matching the pattern')
    expect(result.text).toContain('something else')
  })

  it('a_wait_has_a_timeout_of_at_most_ten_minutes_and_one_that_runs_out_returns_what_it_last_saw', async () => {
    expect(MAX_WAIT_SECONDS).toBe(600)
    const { id } = commands.start('s1', 'echo busy; sleep 30', 'x', dir)
    // A loaded machine can take a while to start the shell; the wait is about a command that has printed.
    const watched = commands.watch('s1', id)!
    for (let i = 0; i < 200 && !watched.output().includes('busy'); i++) await new Promise((r) => setTimeout(r, 50))
    const out = await run({ until: 'output', id, pattern: 'never', timeoutSeconds: 0.3 })
    expect(out.text).toContain('Timed out')
    expect(out.text).toContain('busy')
    const closed = createTcp()
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r))
    const port = (closed.address() as { port: number }).port
    await new Promise((r) => closed.close(r))
    const refused = await run({ until: 'port', host: '127.0.0.1', port, timeoutSeconds: 0.2 })
    expect(refused.text).toContain('Timed out')
    expect(refused.text).toContain('Last seen')
    expect(refused.text).toContain('refused')
  })

  it('a_wait_on_a_url_or_a_port_is_judged_as_reaching_the_network_and_one_on_a_file_as_reading_it', () => {
    const ground: CallContext['ground'] = {
      workspace: '/ws', readable: [], scratch: '/ws/.kiwi/scratch/s1', writesAllowed: false, ignored: () => false,
      recoverable: () => false, trusted: () => false, denyGitWrites: false, home: '/home/me',
    }
    const context: CallContext = { grants: [], ground, home: '/home/me', exists: () => undefined, tools: { readOnly: (n) => n === BACKGROUND_WAIT_TOOL } }
    // Only the tool's own name differs between a wait and the call it is judged like.
    const judged = (name: string, input: unknown) => JSON.parse(JSON.stringify(judgeCall(name, input, '/ws', context)).split(name).join('TOOL').replace(/TOOLs /g, 'Reads '))
    expect(judged(BACKGROUND_WAIT_TOOL, { until: 'url', url: 'https://example.com' })).toEqual(judged('WebFetch', { url: 'https://example.com' }))
    expect(judged(BACKGROUND_WAIT_TOOL, { until: 'port', port: 80 })).toEqual(judged('WebFetch', { url: 'https://example.com' }))
    expect(judged(BACKGROUND_WAIT_TOOL, { until: 'file', path: '../outside/x.txt' })).toEqual(judged('Read', { file_path: '../outside/x.txt' }))
    expect(judged(BACKGROUND_WAIT_TOOL, { until: 'file', path: 'src/a.ts' })).toEqual(judged('Read', { file_path: 'src/a.ts' }))
  })

  it('interrupting_the_turn_ends_a_wait_in_progress_and_leaves_the_background_command_running', async () => {
    const { id } = commands.start('s1', 'sleep 30', 'x', dir)
    const waiting = run({ until: 'exit', id })
    setTimeout(() => abort.abort(), 100)
    const result = await waiting
    expect(result.isError).toBe(true)
    expect(result.text).toContain('interrupted')
    expect(commands.runningOf('s1').map((c) => c.id)).toEqual([id])
    const file = await (async () => {
      const second = new AbortController()
      const pending = tool.execute({ until: 'file', path: 'never.txt', change: 'exists' } as never, { cwd: dir, signal: second.signal } as ToolContext)
      setTimeout(() => second.abort(), 50)
      return pending
    })()
    expect(file.text).toContain('interrupted')
  })

  it('both_engines_are_offered_the_wait_with_the_other_background_tools', () => {
    expect(BACKGROUND_TOOLS).toContain(BACKGROUND_WAIT_TOOL)
    expect(backgroundTools('s1', commands).map((t) => t.name)).toContain(BACKGROUND_WAIT_TOOL)
  })
})

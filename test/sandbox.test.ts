import { describe, expect, it } from 'vitest'
import { DEFAULT_SANDBOX_OPTIONS, runSandboxed, type HostCall } from '../src/agent/script/sandbox'

const options = () => ({ signal: new AbortController().signal, ...DEFAULT_SANDBOX_OPTIONS })

describe('runSandboxed', () => {
  it('returns_the_value_the_script_returns', async () => {
    const result = await runSandboxed('return 1 + 2', [], async () => undefined, options())
    expect(result).toEqual({ ok: true, value: 3 })
  })

  it('awaits_host_calls_that_settle_later', async () => {
    const host: HostCall = async (name, args) => {
      await new Promise((r) => setTimeout(r, 5))
      return { name, args }
    }
    const result = await runSandboxed('const a = await read("x"); const b = await read("y"); return [a.args, b.args]', ['read'], host, options())
    expect(result).toEqual({ ok: true, value: [['x'], ['y']] })
  })

  it('surfaces_a_failing_host_call_as_a_catchable_error', async () => {
    const host: HostCall = async () => {
      throw new Error('denied')
    }
    const result = await runSandboxed('try { await read("x") } catch (e) { return e.message }', ['read'], host, options())
    expect(result).toEqual({ ok: true, value: 'denied' })
  })

  it('reports_a_thrown_script_error', async () => {
    const result = await runSandboxed('throw new Error("boom")', [], async () => undefined, options())
    expect(result).toEqual({ ok: false, error: 'Error: boom' })
  })

  it('has_no_ambient_access_to_the_host', async () => {
    const result = await runSandboxed('return [typeof require, typeof process, typeof fetch, typeof globalThis.fs]', [], async () => undefined, options())
    expect(result).toEqual({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined'] })
  })

  it('stops_a_script_that_never_ends', async () => {
    const result = await runSandboxed('while (true) {}', [], async () => undefined, { ...options(), cpuBudgetMs: 100 })
    expect(result).toEqual({ ok: false, error: 'Script exceeded its time budget' })
  })

  it('does_not_count_time_spent_waiting_on_the_host_against_the_budget', async () => {
    const host: HostCall = () => new Promise((r) => setTimeout(() => r('late'), 300))
    const result = await runSandboxed('return await ask()', ['ask'], host, { ...options(), cpuBudgetMs: 100 })
    expect(result).toEqual({ ok: true, value: 'late' })
  })

  it('stops_when_the_turn_is_interrupted', async () => {
    const abort = new AbortController()
    setTimeout(() => abort.abort(), 50)
    const never: HostCall = () => new Promise(() => {})
    const result = await runSandboxed('await ask()', ['ask'], never, { ...options(), signal: abort.signal })
    expect(result).toEqual({ ok: false, error: 'Interrupted' })
  })

  it('collects_console_log_lines', async () => {
    const lines: string[] = []
    await runSandboxed('console.log("a", {b: 1})', [], async () => undefined, options(), (l) => lines.push(l))
    expect(lines).toEqual(['a {"b":1}'])
  })
})

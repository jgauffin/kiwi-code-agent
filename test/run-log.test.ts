import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunLog } from '../src/agent/runs/run-log'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'run-log-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('RunLog', () => {
  it('events_are_read_back_in_emission_order_even_when_appends_are_not_awaited', () =>
    withTempDir(async (dir) => {
      const log = RunLog.forSession(dir, 'sess')
      void log.append({ type: 'user_message', text: 'one' })
      void log.append({ type: 'assistant_text', messageId: 'm', delta: 'two' })
      await log.append({ type: 'ended' })
      const entries = await log.read()
      expect(entries.map((e) => e.event.type)).toEqual(['user_message', 'assistant_text', 'ended'])
      expect(entries[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }))

  it('a_session_without_a_log_yet_reads_as_empty', () =>
    withTempDir(async (dir) => {
      expect(await RunLog.forSession(dir, 'never').read()).toEqual([])
    }))

  it('log_lives_under_agent_runs_per_session', () =>
    withTempDir(async (dir) => {
      expect(RunLog.forSession(dir, 'abc').path).toBe(join(dir, '.agent', 'runs', 'abc', 'events.jsonl'))
    }))
})

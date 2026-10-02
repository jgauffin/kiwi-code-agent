import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  it('settled_waits_for_appends_nobody_awaited_so_a_read_right_after_them_sees_them', () =>
    withTempDir(async (dir) => {
      const log = RunLog.forSession(dir, 'sess')
      void log.append({ type: 'user_message', text: 'one' })
      void log.append({ type: 'ended' })
      await log.settled()
      expect((await log.read()).map((e) => e.event.type)).toEqual(['user_message', 'ended'])
    }))

  it('text_the_extension_wrote_is_not_readable_in_the_file_but_reads_back_whole', () =>
    withTempDir(async (dir) => {
      const log = RunLog.forSession(dir, 'sess')
      await log.append({ type: 'user_message', text: 'the kickoff prompt', label: 'Started task 1' })
      await log.append({ type: 'tool_result', toolUseId: 't', text: 'ok', isError: false, context: 'hook context' })
      const raw = await readFile(log.path, 'utf8')
      expect(raw).not.toMatch(/kickoff prompt|hook context/)
      expect(raw).toContain('Started task 1')
      expect((await log.read()).map((e) => e.event)).toEqual([
        { type: 'user_message', text: 'the kickoff prompt', label: 'Started task 1' },
        { type: 'tool_result', toolUseId: 't', text: 'ok', isError: false, context: 'hook context' },
      ])
    }))

  it('a_log_written_before_sealing_still_reads', () =>
    withTempDir(async (dir) => {
      const log = RunLog.forSession(dir, 'sess')
      await mkdir(log.dir, { recursive: true })
      const entry = { at: '2026-01-01T00:00:00.000Z', event: { type: 'user_message', text: 'plain kickoff', label: 'Started' } }
      await writeFile(log.path, JSON.stringify(entry) + '\n', 'utf8')
      expect((await log.read())[0]!.event).toEqual(entry.event)
    }))

  it('a_session_without_a_log_yet_reads_as_empty', () =>
    withTempDir(async (dir) => {
      expect(await RunLog.forSession(dir, 'never').read()).toEqual([])
    }))

  it('log_lives_under_agent_runs_per_session', () =>
    withTempDir(async (dir) => {
      expect(RunLog.forSession(dir, 'abc').path).toBe(join(dir, '.kiwi', 'runs', 'abc', 'events.jsonl'))
    }))
})

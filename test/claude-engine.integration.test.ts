import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from '../src/agent/session/async-queue'
import { COMPACT_COMMAND } from '../src/agent/sdk-session/compaction'

/**
 * What SdkCompaction relies on the real Claude Code engine to do. Runs on this
 * machine's Claude login and costs a few small requests, so it is opt-in.
 */
const enabled = process.env.KIWI_CLAUDE_INTEGRATION === '1'
const model = process.env.KIWI_CLAUDE_MODEL ?? 'claude-sonnet-5'

async function engine(env: Record<string, string> = {}) {
  const input = new AsyncQueue<SDKUserMessage>()
  const q: Query = query({
    prompt: input,
    options: {
      cwd: await mkdtemp(join(tmpdir(), 'kiwi-engine-')),
      model,
      settingSources: [],
      includePartialMessages: true,
      executable: 'node',
      pathToClaudeCodeExecutable: resolve('node_modules/@anthropic-ai/claude-agent-sdk/cli.js'),
      env: { ...process.env, DISABLE_AUTO_COMPACT: '1', ...env } as Record<string, string>,
    },
  })
  const seen: SDKMessage[] = []
  const iterator = q[Symbol.asyncIterator]()
  /** Reads the engine's messages up to the first that matches; all of them land in `seen`. */
  const until = async (match: (m: SDKMessage) => boolean): Promise<SDKMessage> => {
    for (;;) {
      const next = await iterator.next()
      if (next.done) throw new Error('engine stream ended')
      seen.push(next.value)
      if (match(next.value)) return next.value
    }
  }
  const send = (text: string) => input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  const close = () => {
    input.end()
    q.close()
  }
  return { q, until, send, seen, close }
}

const isResult = (m: SDKMessage) => m.type === 'result'

describe.runIf(enabled)('Claude Code engine', () => {
  it('leaves_compaction_to_the_host_when_told_and_says_what_window_it_budgets', { timeout: 120_000 }, async () => {
    const e = await engine()
    try {
      e.send('Reply with the single word: ok')
      const init = await e.until((m) => m.type === 'system' && m.subtype === 'init')
      expect(init.type === 'system' && init.subtype === 'init' && init.slash_commands).toContain('compact')
      await e.until(isResult)
      const usage = await e.q.getContextUsage()
      expect(usage.isAutoCompactEnabled).toBe(false)
      expect(usage.maxTokens).toBeGreaterThan(usage.totalTokens)
      // SdkCompaction budgets against maxTokens: a 1M model has to show its whole window there.
      if (model.endsWith('[1m]')) expect({ maxTokens: usage.maxTokens, rawMaxTokens: usage.rawMaxTokens }).toEqual({ maxTokens: 1_000_000, rawMaxTokens: 1_000_000 })
    } finally {
      e.close()
    }
  })

  it('a_stopped_turn_can_be_compacted_and_carried_on', { timeout: 180_000 }, async () => {
    const e = await engine()
    try {
      e.send('Write the numbers from one to three hundred as English words, one per line. Nothing else.')
      await e.until((m) => m.type === 'stream_event' && m.event.type === 'content_block_delta')
      await e.q.interrupt()
      expect(await e.until(isResult)).toMatchObject({ subtype: 'error_during_execution', is_error: true })

      const compacting = e.seen.length
      e.send(COMPACT_COMMAND)
      expect(await e.until(isResult)).toMatchObject({ is_error: false })
      const during = e.seen.slice(compacting)
      expect(during).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'status', compact_result: 'success' }))
      expect(during).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'compact_boundary' }))

      e.send('Continue where you stopped, but only up to twenty.')
      expect(await e.until(isResult)).toMatchObject({ subtype: 'success', is_error: false })
    } finally {
      e.close()
    }
  })

  // SdkCompaction reads a failure from the status and the made-up reply, because the result says success regardless.
  it('a_summary_over_the_output_cap_fails_the_compaction_in_status_and_a_made_up_reply', { timeout: 120_000 }, async () => {
    // The cap governs the summary too; this low, the first reply fails as well, but it still gives the conversation something to summarise.
    const e = await engine({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '20' })
    try {
      e.send('Reply with the single word: ok')
      await e.until(isResult)
      const compacting = e.seen.length
      e.send('/compact')
      expect(await e.until(isResult)).toMatchObject({ is_error: false })
      const during = e.seen.slice(compacting)
      expect(during).toContainEqual(expect.objectContaining({ type: 'system', subtype: 'status', compact_result: 'failed', compact_error: expect.stringMatching(/20 output token maximum/) }))
      expect(syntheticTexts(during)).toEqual([expect.stringMatching(/^Error: Error during compaction: /)])
    } finally {
      e.close()
    }
  })

  it('compacting_nothing_is_turned_down_in_a_made_up_reply_and_a_successful_result', { timeout: 120_000 }, async () => {
    const e = await engine()
    try {
      e.send('/compact')
      expect(await e.until(isResult)).toMatchObject({ is_error: false })
      expect(e.seen).not.toContainEqual(expect.objectContaining({ compact_result: 'failed' }))
      expect(syntheticTexts(e.seen)).toEqual([expect.stringMatching(/^Error: /)])
    } finally {
      e.close()
    }
  })
})

function syntheticTexts(messages: SDKMessage[]): string[] {
  return messages.flatMap((m) =>
    m.type === 'assistant' && m.message.model === '<synthetic>' ? m.message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])) : [],
  )
}

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from '../src/agent/session/async-queue'

/**
 * Whether the JavaScript engine (SDK 0.2.112) can run a 5.x model with its 1M
 * window, which decides if a native-binary engine is needed for it. Runs on this
 * machine's Claude login and costs one small request, so it is opt-in.
 */
const enabled = process.env.KIWI_CLAUDE_INTEGRATION === '1'
const model = process.env.KIWI_CLAUDE_1M_MODEL ?? 'claude-opus-5[1m]'

describe.runIf(enabled)('Claude Code engine, 1M context', () => {
  it('a_1m_model_id_gives_the_JS_engine_a_1M_window', { timeout: 120_000 }, async () => {
    const input = new AsyncQueue<SDKUserMessage>()
    const q = query({
      prompt: input,
      options: {
        cwd: await mkdtemp(join(tmpdir(), 'kiwi-engine-')),
        model,
        settingSources: [],
        executable: 'node',
        pathToClaudeCodeExecutable: resolve('node_modules/@anthropic-ai/claude-agent-sdk/cli.js'),
        env: { ...process.env } as Record<string, string>,
      },
    })
    try {
      input.push({ type: 'user', message: { role: 'user', content: 'Reply with the single word: ok' }, parent_tool_use_id: null })
      // Read by hand: leaving a for-await loop would close the query before getContextUsage.
      const iterator = q[Symbol.asyncIterator]()
      let result: SDKMessage | undefined
      while (result?.type !== 'result') {
        const next = await iterator.next()
        if (next.done) throw new Error('engine stream ended')
        result = next.value
      }
      const usage = await q.getContextUsage()
      const modelUsage = result?.type === 'result' ? result.modelUsage : {}
      console.log(JSON.stringify({ model, result: result?.type === 'result' ? result.subtype : undefined, modelUsage, maxTokens: usage.maxTokens, rawMaxTokens: usage.rawMaxTokens }, null, 2))

      expect(result).toMatchObject({ subtype: 'success', is_error: false })
      expect(Math.max(...Object.values(modelUsage).map((u) => u.contextWindow))).toBeGreaterThanOrEqual(1_000_000)
      expect(usage.rawMaxTokens).toBeGreaterThanOrEqual(1_000_000)
    } finally {
      input.end()
      q.close()
    }
  })
})

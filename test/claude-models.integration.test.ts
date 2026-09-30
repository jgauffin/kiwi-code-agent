import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from '../src/agent/session/async-queue'

/**
 * Claude sessions are sent the effort a profile asks for whatever the model,
 * since the engine's own model list names aliases rather than the ids a
 * provider lists. That holds only while the engine takes a level the model
 * lacks without failing the turn. Opt-in like the other engine tests.
 */
const enabled = process.env.KIWI_CLAUDE_INTEGRATION === '1'

describe.runIf(enabled)('Claude engine effort', () => {
  it('an_effort_level_the_model_lacks_does_not_fail_the_turn', { timeout: 120_000 }, async () => {
    const input = new AsyncQueue<SDKUserMessage>()
    const q = query({
      prompt: input,
      options: {
        cwd: await mkdtemp(join(tmpdir(), 'kiwi-effort-')),
        model: 'claude-haiku-4-5',
        effort: 'max',
        settingSources: [],
        executable: 'node',
        pathToClaudeCodeExecutable: resolve('node_modules/@anthropic-ai/claude-agent-sdk/cli.js'),
      },
    })
    try {
      input.push({ type: 'user', message: { role: 'user', content: 'Reply with the single word: ok' }, parent_tool_use_id: null })
      let result: SDKMessage | undefined
      for await (const m of q) {
        if (m.type !== 'result') continue
        result = m
        break
      }
      expect(result).toMatchObject({ subtype: 'success', is_error: false })
    } finally {
      input.end()
      q.close()
    }
  })
})

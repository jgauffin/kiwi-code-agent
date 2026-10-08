import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { SdkSession } from '../src/agent/sdk-session/sdk-session'
import { installedClaude } from '../src/agent/sdk-session/installed-claude'
import type { SessionEvent } from '../src/agent/session/code-session'

/**
 * A whole session on the Claude Code installed on this machine, which is the
 * engine that reaches a model the bundled one refuses. What it proves is that
 * the bundled SDK wrapper drives an engine newer than itself: the models come
 * from the engine, and its messages still map to the same SessionEvents. Only
 * a real run says so, since the installed Claude Code is the person's to
 * update. Runs on this machine's Claude login and costs one small request, so
 * it is opt-in, and it skips itself where no Claude Code is installed to run.
 */
const enabled = process.env.KIWI_CLAUDE_INTEGRATION === '1'
const enginePath = installedClaude(process.env.KIWI_CLAUDE_PATH)
const model = process.env.KIWI_CLAUDE_INSTALLED_MODEL ?? 'claude-opus-5-5[1m]'

describe.runIf(enabled && enginePath !== undefined)('a session on the installed Claude Code', () => {
  it('answers_on_a_model_the_bundled_engine_refuses_and_its_messages_become_session_events', { timeout: 180_000 }, async () => {
    const session = new SdkSession({
      id: 'installed-1',
      profile: { name: 'Installed', engine: 'claude-installed', model },
      cwd: await mkdtemp(join(tmpdir(), 'kiwi-installed-')),
      enginePath: enginePath!,
      query,
    })
    const seen: SessionEvent[] = []
    try {
      session.send('Reply with the single word: ok')
      for await (const event of session.events()) {
        seen.push(event)
        if (event.type === 'turn_done') break
      }
    } finally {
      await session.dispose()
    }

    expect(seen.find((e) => e.type === 'session_started')).toMatchObject({ engineSessionId: expect.any(String), engineVersion: expect.any(String) })
    expect(seen.filter((e) => e.type === 'error')).toEqual([])
    expect(seen.at(-1)).toMatchObject({ type: 'turn_done', isError: false })
    const said = seen
      .filter((e): e is Extract<SessionEvent, { type: 'assistant_text' }> => e.type === 'assistant_text')
      .map((e) => e.delta)
      .join('')
    expect(said.toLowerCase()).toContain('ok')
  })
})

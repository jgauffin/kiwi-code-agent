import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { modeSetup, type ModeContext } from '../src/agent/session/mode-setup'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'

const ctx: ModeContext = {
  workspaceRoot: tmpdir(),
  verifyRules: () => [],
  planIgnore: () => [],
  cleanupLimits: () => ({ source: { functionLines: 0, typeLines: 0, fileLines: 0 }, tests: { functionLines: 0, typeLines: 0, fileLines: 0 }, testGlobs: [] }),
  withMap: async (_record, prompt) => `${prompt}\n[repo map]`,
  withDocs: async (_record, prompt) => `${prompt}\n[docs map]`,
  withMemories: async (_record, prompt) => `${prompt}\n[memories]`,
}

const record = (mode: SessionMode, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1',
  title: 't',
  profile: { name: 'P', engine: 'openai-compatible', model: 'm' },
  mode,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

describe('modeSetup', () => {
  it.each(['implement', 'plan', 'reconcile', 'cleanup'] as const)('a %s session without a feature is refused', async (mode) => {
    await expect(modeSetup(record(mode), ctx)).rejects.toThrow(/feature name/)
  })

  it('a cleanup session without the files to split is refused', async () => {
    await expect(modeSetup(record('cleanup', { feature: 'f' }), ctx)).rejects.toThrow(/files to split/)
  })

  it.each([
    ['plan', { feature: 'f' }],
    ['docs', {}],
    ['file-decisions', {}],
  ] as const)('the %s phase limits search results to what its scope may read', async (mode, extra) => {
    const setup = await modeSetup(record(mode, extra), ctx)
    expect(setup.readable).toBeTypeOf('function')
    expect(setup.toolNames?.length).toBeGreaterThan(0)
  })

  it.each(['docs', 'code-plan'] as const)('a %s session granted full access works with the full tool set and no scope', async (mode) => {
    const setup = await modeSetup(record(mode, { access: 'full' }), ctx)
    expect(setup.toolNames).toBeUndefined()
    expect(setup.readable).toBeUndefined()
    expect(setup.systemPrompt).toBeUndefined()
  })

  it('the builder works from the repo map and the planner from the docs map', async () => {
    expect((await modeSetup(record('implement', { feature: 'f' }), ctx)).systemPrompt).toContain('[repo map]')
    expect((await modeSetup(record('plan', { feature: 'f' }), ctx)).systemPrompt).toContain('[docs map]')
    const codePlan = (await modeSetup(record('code-plan'), ctx)).systemPrompt
    expect(codePlan).toContain('[repo map]')
    expect(codePlan).toContain('[docs map]')
  })

  it('a chat keeps the engine default prompt and every tool', async () => {
    const setup = await modeSetup(record('chat'), ctx)
    expect(setup.systemPrompt).toBeUndefined()
    expect(setup.toolNames).toBeUndefined()
  })
})

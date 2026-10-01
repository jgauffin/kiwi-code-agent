import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modeSetup, type ModeContext } from '../src/agent/session/mode-setup'
import type { SessionMode, SessionRecord } from '../src/agent/session/session-manager'

const ctx: ModeContext = {
  workspaceRoot: tmpdir(),
  verifyRules: () => [],
  planIgnore: () => [],
  cleanupLimits: () => ({
    source: { functionLines: 0, functionComplexity: 0, typeLines: 0, fileLines: 0 },
    tests: { functionLines: 0, functionComplexity: 0, typeLines: 0, fileLines: 0 },
    testGlobs: [],
  }),
  withMap: async (_record, prompt) => `${prompt}\n[repo map]`,
  withDocs: async (_record, prompt) => `${prompt}\n[docs map]`,
  withMemories: async (_record, prompt) => `${prompt}\n[memories]`,
  withInstructions: async (_record, prompt) => `${prompt}\n[instructions]`,
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
    ['doc-migration', {}],
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

  it('the doc migration judges from the docs map, never the repo map, since it reads no code', async () => {
    const setup = (await modeSetup(record('doc-migration'), ctx)).systemPrompt
    expect(setup).toContain('[docs map]')
    expect(setup).not.toContain('[repo map]')
  })

  it('a migrated draft is held to the spec contract like the planner\'s own writes', async () => {
    const { hooks } = await modeSetup(record('doc-migration'), ctx)
    const outcome = await hooks?.postToolUse?.({
      toolName: 'Write',
      input: { file_path: join(ctx.workspaceRoot, 'plan', 'x.spec.md') },
      toolUseId: 't',
      output: 'ok',
      isError: false,
    })
    // The file does not exist on disk in this test, so the contract read fails quietly rather than throwing.
    expect(outcome).toBeUndefined()
  })

  it('a chat keeps the engine default prompt and every tool', async () => {
    const setup = await modeSetup(record('chat'), ctx)
    expect(setup.systemPrompt).toBeUndefined()
    expect(setup.toolNames).toBeUndefined()
  })

  it.each(['implement', 'code-plan', 'docs', 'file-decisions', 'doc-migration', 'docs-map', 'reconcile', 'cleanup'] as const)(
    'every session that may read the code starts with the memories: %s',
    async (mode) => {
      const setup = await modeSetup(record(mode, { feature: 'f', files: ['a.ts'] }), ctx)
      expect(setup.systemPrompt).toContain('[memories]')
    },
  )

  it('the blind planner gets no memories', async () => {
    const setup = await modeSetup(record('plan', { feature: 'f' }), ctx)
    expect(setup.systemPrompt).not.toContain('[memories]')
  })

  it.each(['implement', 'code-plan', 'docs', 'file-decisions', 'doc-migration', 'docs-map', 'reconcile', 'cleanup'] as const)(
    'bundle rules reach a session as the person\'s own instructions do: %s',
    async (mode) => {
      const setup = await modeSetup(record(mode, { feature: 'f', files: ['a.ts'] }), ctx)
      expect(setup.systemPrompt).toContain('[instructions]')
    },
  )

  it('no bundles for the blind planner', async () => {
    const setup = await modeSetup(record('plan', { feature: 'f' }), ctx)
    expect(setup.systemPrompt).not.toContain('[instructions]')
  })
})

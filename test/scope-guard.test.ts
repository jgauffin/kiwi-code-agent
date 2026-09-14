import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope, featureSlug, specPath } from '../src/agent/phases/blind-plan'
import { composeHooks } from '../src/agent/session/hooks'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, blindPlanScope('Order cancellation'))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('ScopeGuard for blind planning', () => {
  it('intent_docs_are_readable_source_is_not', async () => {
    expect(await use('Read', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Read', { file_path: `${cwd}/docs/intent/sub/deep.md` })).toBeUndefined()
    const denied = await use('Read', { file_path: 'src/Orders/OrderService.cs' })
    expect(denied).toMatchObject({ deny: expect.stringContaining('limited to docs/intent/**') })
  })

  it('searching_is_allowed_only_inside_the_intent_tree_so_no_file_names_leak', async () => {
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs/intent' })).toBeUndefined()
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs/intent/orders' })).toBeUndefined()
    expect(await use('Glob', { pattern: 'docs/intent/**/*.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
  })

  it('only_the_spec_file_is_writable', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'plan/other.spec.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('paths_outside_the_workspace_and_bash_are_denied', async () => {
    expect(await use('Read', { file_path: '../secrets.txt' })).toMatchObject({ deny: expect.stringContaining('outside') })
    expect(await use('Bash', { command: 'cat src/x.cs' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_spec_itself_can_be_read_back_for_revision', async () => {
    expect(await use('Read', { file_path: 'plan/order-cancellation.spec.md' })).toBeUndefined()
  })
})

describe('blind plan helpers', () => {
  it('feature_slug_is_filesystem_safe_and_stable', () => {
    expect(featureSlug('Order cancellation (v2)!')).toBe('order-cancellation-v2')
    expect(featureSlug('   ')).toBe('feature')
  })

  it('spec_lives_under_plan_in_the_workspace', () => {
    expect(specPath(cwd, 'Order cancellation')).toBe(`${cwd}${process.platform === 'win32' ? '\\' : '/'}plan${process.platform === 'win32' ? '\\' : '/'}order-cancellation.spec.md`)
  })

  it('prompt_names_the_feature_the_spec_file_and_the_stable_ids', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('status: draft')
    expect(prompt).toContain('never renumber')
    expect(BLIND_PLAN_TOOLS).toEqual(['Read', 'Glob', 'Write'])
  })
})

describe('composeHooks', () => {
  it('first_deny_wins_and_contexts_are_joined', async () => {
    const hooks = composeHooks(
      { async preToolUse() { return { additionalContext: 'a' } } },
      { async preToolUse(tool) { return tool.toolName === 'Bash' ? { deny: 'no' } : { additionalContext: 'b' } } },
    )
    expect(await hooks.preToolUse!({ toolName: 'Read', input: {}, toolUseId: 't' })).toEqual({ additionalContext: 'a\n\nb' })
    expect(await hooks.preToolUse!({ toolName: 'Bash', input: {}, toolUseId: 't' })).toEqual({ deny: 'no' })
  })

  it('stop_collects_verifications_until_one_blocks', async () => {
    const hooks = composeHooks(
      { async stop() { return { verifications: [{ command: 'a', cwd: '/', ok: true, output: '' }] } } },
      { async stop() { return { verifications: [{ command: 'b', cwd: '/', ok: false, output: 'x' }], block: 'fix b' } } },
      { async stop() { throw new Error('must not run') } },
    )
    const outcome = await hooks.stop!(() => {})
    expect(outcome?.block).toBe('fix b')
    expect(outcome?.verifications?.map((v) => v.command)).toEqual(['a', 'b'])
  })
})

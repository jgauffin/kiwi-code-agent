import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope, featureSlug, specPath } from '../src/agent/phases/blind-plan'
import { composeHooks } from '../src/agent/session/hooks'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, blindPlanScope('Order cancellation', ['docs/api/**', 'docs/**/*.generated.md']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('ScopeGuard for blind planning', () => {
  it('docs_are_readable_source_is_not', async () => {
    expect(await use('Read', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'docs/features/refunds.md' })).toBeUndefined()
    expect(await use('Read', { file_path: `${cwd}/docs/intent/sub/deep.md` })).toBeUndefined()
    const denied = await use('Read', { file_path: 'src/Orders/OrderService.cs' })
    expect(denied).toMatchObject({ deny: expect.stringContaining('limited to docs/**') })
  })

  it('ignored_globs_from_settings_are_denied_even_inside_docs', async () => {
    expect(await use('Read', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.stringContaining('docs/api/**') })
    expect(await use('Read', { file_path: 'docs/intent/schema.generated.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Glob', { pattern: '*', path: 'docs/api' })).toMatchObject({ deny: expect.any(String) })
  })

  it('searching_is_allowed_only_inside_docs_so_no_file_names_leak', async () => {
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs' })).toBeUndefined()
    expect(await use('Glob', { pattern: '**/*.md', path: 'docs/intent/orders' })).toBeUndefined()
    expect(await use('Glob', { pattern: 'docs/**/*.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
  })

  it('only_the_spec_file_and_its_review_are_writable_and_writing_them_needs_no_permission_prompt', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.review.md' })).toEqual({ allow: true })
    expect(await use('Read', { file_path: 'plan/order-cancellation.review.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'plan/other.spec.md' })).toMatchObject({ deny: expect.any(String) })
    // Intent is amended by proposing, never by writing: the planner owns the amendment file, not the doc.
    expect(await use('Write', { file_path: 'plan/order-cancellation.intent.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('paths_outside_the_workspace_and_bash_are_denied', async () => {
    expect(await use('Read', { file_path: '../secrets.txt' })).toMatchObject({ deny: expect.stringContaining('outside') })
    expect(await use('Bash', { command: 'cat src/x.cs' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_spec_itself_can_be_read_back_for_revision', async () => {
    expect(await use('Read', { file_path: 'plan/order-cancellation.spec.md' })).toBeUndefined()
  })

  it('the_root_readme_counts_as_intent_whatever_its_casing', async () => {
    expect(await use('Read', { file_path: 'README.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'src/README.md' })).toMatchObject({ deny: expect.any(String) })
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
    expect(prompt).toContain('Write nothing until the user says go')
    expect(BLIND_PLAN_TOOLS).toEqual(['Read', 'Glob', 'Write', 'Edit'])
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

  it('an_allow_from_any_hook_survives_composition_unless_another_denies', async () => {
    const allowing = { async preToolUse() { return { allow: true as const } } }
    const noting = { async preToolUse() { return { additionalContext: 'n' } } }
    const denying = { async preToolUse() { return { deny: 'no' } } }
    const use = { toolName: 'Write', input: {}, toolUseId: 't' }
    expect(await composeHooks(allowing, noting).preToolUse!(use)).toEqual({ allow: true, additionalContext: 'n' })
    expect(await composeHooks(allowing, denying).preToolUse!(use)).toEqual({ deny: 'no' })
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

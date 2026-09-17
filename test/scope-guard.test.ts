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

  it('only_the_spec_file_its_review_and_its_decisions_are_writable_and_writing_them_needs_no_permission_prompt', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.review.md' })).toEqual({ allow: true })
    expect(await use('Read', { file_path: 'plan/order-cancellation.review.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'plan/other.spec.md' })).toMatchObject({ deny: expect.any(String) })
    // The planner proposes on the decisions in their own file; the mapper's other file, the tasks, is not its to read.
    expect(await use('Edit', { file_path: 'plan/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Read', { file_path: 'plan/order-cancellation.decisions.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'plan/order-cancellation.tasks.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_docs_are_the_users_so_a_write_there_is_neither_allowed_outright_nor_denied_but_asked', async () => {
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'docs/features/refunds.md' })).toBeUndefined()
    // A doc hidden from the planner cannot be written either.
    expect(await use('Edit', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('every_specs_is_readable_as_intent_but_no_other_features_review_tasks_or_decisions', async () => {
    expect(await use('Read', { file_path: 'plan/refunds.spec.md' })).toBeUndefined()
    expect(await use('Glob', { pattern: '*.spec.md', path: 'plan' })).toBeUndefined()
    expect(await use('Read', { file_path: 'plan/refunds.review.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: 'plan/refunds.tasks.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: 'plan/refunds.decisions.md' })).toMatchObject({ deny: expect.any(String) })
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

  it('prompt_names_the_feature_the_spec_file_and_the_stable_names', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('plan/order-cancellation.decisions.md')
    expect(prompt).toContain('status: draft')
    expect(prompt).toContain('it never changes once written')
    expect(prompt).toContain('(was Old name)')
    expect(prompt).toContain('Write nothing until the user says go')
    expect(BLIND_PLAN_TOOLS).toEqual(['Read', 'Glob', 'JsonSchema', 'JsonQuery', 'Write', 'Edit', 'AskUser'])
  })

  it('prompt_states_the_contract_scenarios_with_nested_edges_and_no_restating_sections', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('one `##` section per scenario')
    expect(prompt).toContain('indented under the rule it qualifies')
    expect(prompt).toContain('no invariants, acceptance criteria or task sections')
    expect(prompt).toContain('  - **Shipped order**:')
  })

  it('prompt_reads_the_other_specs_as_intent_and_asks_when_a_doc_and_a_spec_disagree', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('plan/*.spec.md')
    expect(prompt).toContain("an approved spec is that feature's definition")
    expect(prompt).toContain('Where a doc and an approved spec disagree, ask')
    expect(prompt).toContain('or of another feature\'s spec ends with its citation')
    // The docs are edited only on request, and never by way of an amendment file.
    expect(prompt).toContain('only when the user asks you to')
    expect(prompt).not.toContain('intent.md')
    expect(prompt).not.toContain('amendment')
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
})

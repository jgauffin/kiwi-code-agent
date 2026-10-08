import { describe, expect, it } from 'vitest'
import { ScopeGuard, readableIn } from '../src/agent/phases/scope-guard'
import { BLIND_PLAN_TOOLS, blindPlanPrompt, blindPlanScope, featureSlug, specPath } from '../src/agent/phases/blind-plan'
import { composeHooks } from '../src/agent/session/hooks'
import { fileDecisionsScope } from '../src/agent/phases/file-decisions'
import { UNFILED_DECISIONS } from '../src/agent/phases/unfiled-decisions'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, blindPlanScope('Order cancellation', ['docs/api/**', 'docs/**/*.generated.md']))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

/**
 * The prompt with its hard wrapping flattened. Its prose paragraphs are
 * wrapped in the source, so a sentence may break anywhere; an assertion on
 * one must not depend on where. Assertions on layout read the prompt itself.
 */
const flowed = (prompt: string): string => prompt.replace(/\s+/g, ' ')

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

  it('markdown_search_is_held_to_the_same_paths_as_grep', async () => {
    expect(await use('MarkdownSearch', { query: 'cancel', path: 'docs' })).toBeUndefined()
    expect(await use('MarkdownSearch', { query: 'cancel', path: 'src' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('MarkdownSearch', { query: 'cancel' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('MarkdownSearch', { query: 'cancel', path: 'docs/api' })).toMatchObject({ deny: expect.any(String) })
  })

  it('files_a_search_finds_under_an_allowed_path_are_held_to_the_read_rule', () => {
    const readable = readableIn(blindPlanScope('Order cancellation', ['docs/api/**']))
    expect(readable('docs/intent/orders.md')).toBe(true)
    expect(readable('docs/api/orders.md')).toBe(false)
    expect(readable('.kiwi/specs/order-cancellation.tasks.json')).toBe(false)
  })

  it('only_the_spec_file_its_review_and_its_decisions_are_writable_and_writing_them_needs_no_permission_prompt', async () => {
    expect(await use('Write', { file_path: 'specs/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: '.kiwi/specs/order-cancellation.review.md' })).toEqual({ allow: true })
    expect(await use('Read', { file_path: '.kiwi/specs/order-cancellation.review.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'specs/other.spec.md' })).toMatchObject({ deny: expect.any(String) })
    // The planner proposes on the decisions in their own file; the mapper's other file, the tasks, is not its to read.
    expect(await use('Edit', { file_path: '.kiwi/specs/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Read', { file_path: '.kiwi/specs/order-cancellation.decisions.md' })).toBeUndefined()
    expect(await use('Read', { file_path: '.kiwi/specs/order-cancellation.tasks.json' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_docs_are_the_users_so_a_write_there_is_neither_allowed_outright_nor_denied_but_asked', async () => {
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Write', { file_path: 'docs/features/refunds.md' })).toBeUndefined()
    // A doc hidden from the planner cannot be written either.
    expect(await use('Edit', { file_path: 'docs/api/orders.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('every_specs_is_readable_as_intent_but_no_other_features_review_tasks_or_decisions', async () => {
    expect(await use('Read', { file_path: 'specs/refunds.spec.md' })).toBeUndefined()
    expect(await use('Glob', { pattern: '*.spec.md', path: 'specs' })).toBeUndefined()
    expect(await use('Read', { file_path: '.kiwi/specs/refunds.review.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: '.kiwi/specs/refunds.tasks.json' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: '.kiwi/specs/refunds.decisions.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('a_spec_filed_in_a_folder_or_deeper_is_readable_too_never_invisible_for_sitting_there', async () => {
    expect(await use('Read', { file_path: 'specs/orders/refunds.spec.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'specs/orders/archive/refunds.spec.md' })).toBeUndefined()
  })

  it('paths_outside_the_workspace_and_bash_are_denied', async () => {
    expect(await use('Read', { file_path: '../secrets.txt' })).toMatchObject({ deny: expect.stringContaining('outside') })
    expect(await use('Bash', { command: 'cat src/x.cs' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_spec_itself_can_be_read_back_for_revision', async () => {
    expect(await use('Read', { file_path: 'specs/order-cancellation.spec.md' })).toBeUndefined()
  })

  it('the_root_readme_counts_as_intent_whatever_its_casing', async () => {
    expect(await use('Read', { file_path: 'README.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'ReadMe.md' })).toBeUndefined()
    expect(await use('Read', { file_path: 'src/README.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('the_unfiled_decisions_are_read_as_intent_and_a_decision_reaching_beyond_the_feature_is_added_without_a_prompt', async () => {
    expect(await use('Read', { file_path: 'specs/unfiled-decisions.md' })).toBeUndefined()
    expect(await use('Edit', { file_path: 'specs/unfiled-decisions.md' })).toEqual({ allow: true })
  })

  it('the_future_work_is_read_as_intent_and_work_decided_for_later_is_added_without_a_prompt', async () => {
    expect(await use('Read', { file_path: 'specs/future-work.md' })).toBeUndefined()
    expect(await use('Edit', { file_path: 'specs/future-work.md' })).toEqual({ allow: true })
  })

  it('a_move_takes_its_source_out_so_the_source_is_held_to_writable_and_the_destination_too', async () => {
    // Neither end is this feature's own spec, review or decisions: denied on the source before the destination is even looked at.
    expect(await use('Move', { source: 'docs/intent/orders.md', destination: 'specs/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
    // The source is writable, but the destination is another feature's name, outside this phase's writable scope.
    expect(await use('Move', { source: 'specs/order-cancellation.spec.md', destination: 'specs/other.spec.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('a_copy_leaves_its_source_standing_so_only_the_destination_is_held_to_writable', async () => {
    expect(await use('Copy', { source: 'docs/intent/orders.md', destination: 'specs/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Copy', { source: 'src/Orders/OrderService.cs', destination: 'specs/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
  })
})

describe('ScopeGuard for filing decisions', () => {
  const filing = new ScopeGuard(cwd, fileDecisionsScope(['docs/api/**']))
  const file = (toolName: string, input: unknown) => filing.preToolUse({ toolName, input, toolUseId: 't' })

  it('reads_what_a_planner_reads_and_never_the_code', async () => {
    expect(await file('Read', { file_path: 'specs/unfiled-decisions.md' })).toBeUndefined()
    expect(await file('Read', { file_path: 'specs/tenants.spec.md' })).toBeUndefined()
    expect(await file('Read', { file_path: 'docs/intent/identity.md' })).toBeUndefined()
    expect(await file('Read', { file_path: 'src/Tenants/Invite.cs' })).toMatchObject({ deny: expect.any(String) })
    expect(await file('Read', { file_path: '.kiwi/specs/tenants.decisions.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await file('Read', { file_path: 'docs/api/tenants.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('removing_a_filed_entry_needs_no_prompt_but_every_spec_or_doc_write_is_asked', async () => {
    expect(await file('Edit', { file_path: 'specs/unfiled-decisions.md' })).toEqual({ allow: true })
    expect(await file('Edit', { file_path: 'specs/future-work.md' })).toEqual({ allow: true })
    expect(await file('Edit', { file_path: 'specs/tenants.spec.md' })).toBeUndefined()
    expect(await file('Write', { file_path: 'docs/intent/identity.md' })).toBeUndefined()
    expect(await file('Write', { file_path: '.kiwi/specs/tenants.tasks.json' })).toMatchObject({ deny: expect.any(String) })
    expect(await file('Bash', { command: 'ls' })).toMatchObject({ deny: expect.any(String) })
  })
})

describe('blind plan helpers', () => {
  it('feature_slug_is_filesystem_safe_and_stable', () => {
    expect(featureSlug('Order cancellation (v2)!')).toBe('order-cancellation-v2')
    expect(featureSlug('   ')).toBe('feature')
  })

  it('feature_slug_keeps_accented_letters_as_their_base_letter', () => {
    expect(featureSlug('Återbetalning för köp')).toBe('aterbetalning-for-kop')
    expect(featureSlug('Ändra ÅÄÖ')).toBe('andra-aao')
  })

  it('spec_lives_under_specs_in_the_workspace', () => {
    expect(specPath(cwd, 'Order cancellation')).toBe(`${cwd}${process.platform === 'win32' ? '\\' : '/'}specs${process.platform === 'win32' ? '\\' : '/'}order-cancellation.spec.md`)
  })

  it('prompt_names_the_feature_the_spec_file_and_the_stable_names', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('specs/order-cancellation.spec.md')
    expect(prompt).toContain('.kiwi/specs/order-cancellation.decisions.md')
    expect(prompt).toContain('status: draft')
    expect(prompt).toContain('it never changes once written')
    expect(prompt).toContain('(was Old name)')
    expect(flowed(prompt)).toContain('Write nothing until the user says go')
    expect(BLIND_PLAN_TOOLS).toEqual(['Read', 'Glob', 'MarkdownSearch', 'SpecSearch', 'JsonSchema', 'JsonQuery', 'Write', 'Edit', 'MultiEdit', 'AskUser', 'Delegate'])
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
    expect(prompt).toContain('specs/**/*.spec.md')
    expect(flowed(prompt)).toContain("a spec the user has approved is that feature's definition")
    expect(flowed(prompt)).toContain('Where a doc and an approved spec disagree, ask')
    expect(prompt).toContain('or of another feature\'s spec ends with its citation')
    // The docs are edited only on request, and never by way of an amendment file.
    expect(prompt).toContain('only when the user asks you to')
    expect(prompt).not.toContain('intent.md')
    expect(prompt).not.toContain('amendment')
  })

  it('prompt_sends_an_unsettled_question_to_the_research_sub_agent_approved_once_and_never_cited', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(flowed(prompt)).toContain("hand that one question to `Delegate`'s `research` sub agent rather than guessing")
    expect(flowed(prompt)).toContain('Approving that delegation approves the research as a whole')
    expect(flowed(prompt)).toContain('without being asked about each one')
    expect(flowed(prompt)).toContain('fold it into your own default and name the research, not a page address, in your direction')
    // Said once, where every citation rule is said: a research sub agent never earns a citation in the spec itself.
    expect(prompt).toContain('What a research sub agent turns up is never a citation')
  })

  it('prompt_reads_the_unfiled_decisions_as_the_users_latest_word_and_records_what_reaches_beyond_the_feature', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd)
    expect(prompt).toContain('specs/unfiled-decisions.md')
    expect(prompt).toContain('specs/future-work.md')
    expect(prompt).toContain(UNFILED_DECISIONS)
  })
})

describe('blind plan spec folders', () => {
  it('flat_mode_never_opens_a_write_to_a_folder_and_says_nothing_of_one_in_the_direction', async () => {
    const flatGuard = new ScopeGuard(cwd, blindPlanScope('Order cancellation', [], 'flat'))
    const flatUse = (toolName: string, input: unknown) => flatGuard.preToolUse({ toolName, input, toolUseId: 't' })
    expect(await flatUse('Write', { file_path: 'specs/orders/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
    const prompt = blindPlanPrompt('Order cancellation', cwd, 'flat')
    expect(prompt).not.toContain('domain folder')
    expect(prompt).toContain('write one file, `specs/order-cancellation.spec.md`')
  })

  it('by_domain_mode_opens_a_write_to_one_folder_deep_but_not_two', async () => {
    const domainGuard = new ScopeGuard(cwd, blindPlanScope('Order cancellation', [], 'by-domain'))
    const domainUse = (toolName: string, input: unknown) => domainGuard.preToolUse({ toolName, input, toolUseId: 't' })
    expect(await domainUse('Write', { file_path: 'specs/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await domainUse('Write', { file_path: 'specs/orders/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await domainUse('Write', { file_path: 'specs/orders/sub/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
    // The working files stay keyed by the slug alone, flat, whatever folder the spec itself lands in.
    expect(await domainUse('Edit', { file_path: '.kiwi/specs/order-cancellation.review.md' })).toEqual({ allow: true })
  })

  it('by_domain_mode_proposes_the_folder_with_the_direction_reading_existing_folders_and_the_description', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd, 'by-domain', ['orders', 'billing'])
    expect(prompt).toContain('which domain folder the spec will land in')
    expect(prompt).toContain('read from the feature\'s description and the domain language of the docs, never from the feature\'s name alone')
    expect(prompt).toContain('`orders`, `billing`')
    expect(prompt).toContain('write one file, `specs/<folder>/order-cancellation.spec.md`')
  })

  it('a_person_named_folder_wins_whatever_the_workspace_already_has', () => {
    const prompt = blindPlanPrompt('Order cancellation', cwd, 'by-domain', [])
    expect(prompt).toContain('Whatever folder the user names in reply, kept or changed, is the one the spec is written to, whether or not that folder already holds a spec')
    expect(prompt).toContain('the folder only groups specs, it never becomes part of the feature\'s name')
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

import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { RECONCILE_TOOLS, progressLine, reconcileKickoff, reconcilePrompt, reconcileScope } from '../src/agent/phases/reconcile'
import { blindPlanPrompt, decisionsHandoffPrompt, docsAfterApprovalPrompt, docsCutPrompt, docsReviewPrompt, rulingsHandoffPrompt } from '../src/agent/phases/blind-plan'
import { UNFILED_DECISIONS } from '../src/agent/phases/unfiled-decisions'

const cwd = process.platform === 'win32' ? 'D:\\work\\repo' : '/work/repo'
const guard = new ScopeGuard(cwd, reconcileScope('Order cancellation'))
const use = (toolName: string, input: unknown) => guard.preToolUse({ toolName, input, toolUseId: 't' })

describe('ScopeGuard for reconciling', () => {
  it('the_whole_workspace_is_readable_and_searchable', async () => {
    expect(await use('Read', { file_path: 'src/Orders/OrderService.cs' })).toBeUndefined()
    expect(await use('Read', { file_path: 'docs/intent/orders.md' })).toBeUndefined()
    expect(await use('Grep', { pattern: 'cancel', path: 'src' })).toBeUndefined()
    expect(await use('Glob', { pattern: '**/*.cs' })).toBeUndefined()
  })

  it('only_the_decisions_and_the_scenario_context_are_writable_so_the_spec_stays_the_planners_the_board_goes_through_its_tool_and_nothing_leaks_into_code_or_docs', async () => {
    expect(await use('Write', { file_path: '.agent/plan/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: '.agent/plan/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: '.agent/plan/order-cancellation.context.md' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: '.agent/plan/order-cancellation.tasks.json' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'src/Orders/OrderService.cs' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: '.agent/plan/order-cancellation.review.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('bash_and_paths_outside_the_workspace_are_denied', async () => {
    expect(await use('Bash', { command: 'ls' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: '../secrets.txt' })).toMatchObject({ deny: expect.stringContaining('outside') })
  })
})

describe('reconcile prompt', () => {
  const prompt = reconcilePrompt('Order cancellation', cwd)

  it('names_the_spec_the_decisions_file_and_what_to_look_for', () => {
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('.agent/plan/order-cancellation.decisions.md')
    expect(prompt).not.toContain('## Decisions')
    expect(prompt).toContain('- on: Cancel command, Shipped order')
    expect(prompt).toContain('- finding:')
    expect(prompt).toContain('says otherwise')
    expect(prompt).toContain('change or break')
    expect(prompt).toContain('shows to be wrong')
    expect(prompt).toContain('Titles are stable')
    expect(prompt).toContain('[withdrawn]')
    // A ruling that keeps the spec is settled work, not a finding to report again.
    expect(prompt).toContain('ruled `keep` means the spec stands and the code changes')
    // The kind of a finding is nothing the user acts on, so it is not written into the file.
    expect(prompt).not.toContain('- kind:')
    expect(prompt).not.toContain('amendment')
    expect(RECONCILE_TOOLS).toEqual(['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'MarkdownSearch', 'CodeOutline', 'CodeSearch', 'Edit', 'Write', 'Skill'])
  })

  it('a_run_continuing_the_last_check_is_told_the_spec_changed_and_keeps_what_it_read', () => {
    const fresh = reconcileKickoff(false)
    expect(fresh).toContain('Check the spec against the code')
    const again = reconcileKickoff(true)
    expect(again).toContain('changed since you checked it')
    expect(again).toContain('Read it again')
    expect(again).toContain('unless a tool result says')
    expect(again).not.toBe(fresh)
  })

  it('the_spec_stands_in_for_the_docs_and_the_other_specs_so_the_check_does_not_read_them_again', () => {
    expect(prompt).toContain('plan/*.spec.md')
    expect(prompt).toContain('do not browse those')
    expect(prompt).toContain('docs/intent/orders.md#Cancellation')
    expect(blindPlanPrompt('Order cancellation', cwd)).toContain('ends with its citation in parentheses')
  })

  it('a_finding_is_the_disagreement_at_one_symbol_and_leaves_the_remedy_to_the_proposal', () => {
    expect(prompt).toContain('The finding is one or two sentences')
    expect(prompt).toContain('at the one path and symbol that shows it')
    expect(prompt).toContain('not what the spec should say instead, not how to build it')
    // The decision card shows the rule verbatim beside the finding, so restating it is duplication.
    expect(prompt).toContain('Do not quote or restate a rule')
    // The example is at the target length, since the example is what gets copied.
    expect(prompt).toContain('- finding: `Order.cancel` in src/orders/order.ts refuses a shipped order outright, so neither rule can hold as written.')
    expect(prompt).not.toContain('what the task would be')
    expect(prompt).not.toContain('what the spec should say instead)')
  })

  it('the_proposals_and_the_ruling_belong_to_others_and_the_run_ends_silently', () => {
    expect(prompt).toContain('The `proposed`, `recommended` and `because` lines are the planner\'s and the `ruling` line is the user\'s')
    expect(prompt).toContain('The spec is not yours to write')
    expect(prompt).toContain('When the context and the decisions are written, or there are no decisions, stop.')
    expect(prompt).not.toContain('summarise')
  })

  it('every_run_writes_where_each_scenario_is_built_so_the_implementer_starts_there', () => {
    expect(prompt).toContain('.agent/plan/order-cancellation.context.md')
    expect(prompt).toContain('## Cancelling an order')
    expect(prompt).toContain('every run')
    expect(reconcileKickoff(true)).toContain('context')
  })

  it('writes_decisions_only_since_the_board_is_derived_from_the_spec', () => {
    expect(prompt).not.toContain('.tasks.')
    expect(prompt).not.toContain('WriteTasks')
    // A clean check starts the build without a word to the person, so no file is the answer.
    expect(prompt).toContain('With no decision to report, write no file')
  })

  it('code_the_feature_leaves_alone_is_not_a_finding', () => {
    expect(prompt).toContain('code the feature will change or build on')
    expect(prompt).toContain('Behaviour in code the feature leaves alone is not a finding')
    // Where to build decides which code is in play, so it is ruled before the findings it would make moot.
    expect(prompt).toContain('where the feature is built is itself open')
  })

  it('a_how_question_is_the_implementers_not_a_decision', () => {
    expect(prompt).toContain('changes how a rule is built but not what it does is not a decision')
  })

  it('approving_a_migrated_spec_checks_it_through_the_same_decisions_file_as_any_spec', () => {
    expect(prompt).toContain('built: true')
    expect(prompt).toContain('a decision like any other, named in `on` the same way')
    // No separate file or channel for a migrated spec's findings: the one decisions file named above is still the only destination.
    expect(prompt.indexOf('.agent/plan/order-cancellation.decisions.md')).toBeLessThan(prompt.indexOf('built: true'))
  })

  it('a_spec_marked_built_is_asked_whether_the_code_already_does_each_rule_not_only_whether_it_stands_in_the_way', () => {
    expect(prompt).toContain('not only whether the code accommodates it but whether the code already does it')
    expect(prompt).toContain('it is not built here')
    expect(prompt).toContain('report no decisions, the same clean result as any other feature')
  })
})

describe('the handoffs to the planner', () => {
  it('names_the_decisions_to_propose_on_and_forbids_ruling', () => {
    const prompt = decisionsHandoffPrompt('Order cancellation', ['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
    expect(prompt).toContain('- Shipped orders cannot be cancelled\n- Refunds are asynchronous')
    expect(prompt).toContain('.agent/plan/order-cancellation.decisions.md')
    expect(prompt).toContain('one to three `- proposed: ...` lines')
    // A proposal is the rule's replacement text, so picking it is verbatim and the rule stays one sentence.
    expect(prompt).toContain("the rule's new text as it would stand in the spec, one sentence")
    // A rule says what the feature does; how it is stored or transacted is the task's, or it ends up in the contract.
    expect(prompt).toContain('observable behaviour, not how it is built')
    expect(blindPlanPrompt('Order cancellation', cwd)).toContain('observable behaviour, not how it is built')
    // Keeping the rule is the wizard's own option, so the planner does not spend one on it.
    expect(prompt).toContain('do not propose it')
    // The user weighs the options first and meets the argument for one underneath them.
    expect(prompt).toContain('`- recommended: <n>`')
    expect(prompt).toContain('`- because: <one sentence>`')
    expect(prompt).toContain('Recommend on every decision')
    expect(prompt).toContain('Change nothing else')
    expect(prompt).toContain('Then stop')
  })

  it('hands_the_rulings_over_to_be_applied_to_the_approved_spec_and_marked', () => {
    const prompt = rulingsHandoffPrompt('Order cancellation', [
      { title: 'Shipped orders cannot be cancelled', ruling: 'a shipped order is refused' },
      { title: 'Refunds are asynchronous', ruling: 'keep' },
    ])
    expect(prompt).toContain('- Shipped orders cannot be cancelled: a shipped order is refused\n- Refunds are asynchronous: keep')
    expect(prompt).toContain('.agent/plan/order-cancellation.decisions.md')
    expect(prompt).toContain('`keep` keeps the rule as it stands')
    expect(prompt).toContain('the text of a proposal replaces the rule verbatim')
    expect(prompt).toContain('[applied]')
    expect(prompt).not.toContain('amendment')
    // The ruling is the person's own words, so asking them to approve it again would be ceremony.
    expect(prompt).toContain('amend it without a second approval')
    expect(prompt).toContain('checked against the code again when your turn ends')
  })

  it('on_approval_the_planner_lists_what_the_docs_should_now_say_and_edits_only_when_asked', () => {
    const prompt = docsReviewPrompt('Order cancellation')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('is approved')
    expect(prompt).toContain('one line per doc section')
    expect(prompt).toContain('Edit nothing')
    expect(prompt).toContain('asks you to')
  })

  it('cutting_covered_docs_is_opt_in_and_otherwise_the_planner_only_lists_them', () => {
    expect(docsAfterApprovalPrompt('Order cancellation', false)).toBe(docsReviewPrompt('Order cancellation'))
    expect(docsAfterApprovalPrompt('Order cancellation', true)).toBe(docsCutPrompt('Order cancellation'))
  })

  it('cutting_covered_docs_leaves_the_approved_spec_alone_since_a_changed_spec_is_checked_against_the_code_again', () => {
    const prompt = docsCutPrompt('Order cancellation')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('now covers down to what no spec holds')
    expect(prompt).toContain('Leave the spec as it is')
  })

  it('a_covered_section_can_go_but_a_contradicting_one_is_only_reported_on_either_doc_review_or_doc_cut', () => {
    for (const prompt of [docsReviewPrompt('Order cancellation'), docsCutPrompt('Order cancellation')]) {
      expect(prompt).toContain('otherwise than the spec')
      expect(prompt).toContain("which side is current is the user's to say")
    }
  })

  it('a_contradiction_the_user_rules_on_is_recorded_as_an_unfiled_decision_naming_the_feature', () => {
    for (const prompt of [docsReviewPrompt('Order cancellation'), docsCutPrompt('Order cancellation')]) {
      expect(prompt).toContain('record the ruling as an unfiled decision naming "Order cancellation"')
      expect(prompt).toContain(UNFILED_DECISIONS)
    }
  })
})

describe('progress line', () => {
  it('a_tool_call_names_the_tool_and_what_it_is_pointed_at', () => {
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'Read', input: { file_path: 'src/Orders/OrderService.cs' } })).toBe(
      'Read src/Orders/OrderService.cs',
    )
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'Grep', input: { pattern: 'Cancel', path: 'src' } })).toBe(
      'Grep "Cancel" in src',
    )
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'Glob', input: { pattern: '**/*.cs' } })).toBe('Glob **/*.cs in .')
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'Skill', input: { name: 'csharp-style' } })).toBe('Skill csharp-style')
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'Other', input: 'x' })).toBe('Other')
  })

  it('a_board_update_names_the_task_and_where_it_moved', () => {
    expect(progressLine({ type: 'tool_call', toolUseId: 't', name: 'UpdateTask', input: { task: 'Cancel command', state: 'in_progress' } })).toBe(
      'Cancel command: in progress',
    )
  })

  it('an_assistant_message_shows_its_first_line_clipped', () => {
    expect(progressLine({ type: 'assistant_message', messageId: 'm', text: '\nLooking at cancellation.\nMore.' })).toBe(
      'Looking at cancellation.',
    )
    const long = 'x'.repeat(150)
    expect(progressLine({ type: 'assistant_message', messageId: 'm', text: long })).toHaveLength(100)
    expect(progressLine({ type: 'assistant_message', messageId: 'm', text: '  ' })).toBeUndefined()
  })

  it('an_error_is_shown_and_the_rest_says_nothing', () => {
    expect(progressLine({ type: 'error', message: 'boom', fatal: false })).toBe('Check failed: boom')
    expect(progressLine({ type: 'tool_result', toolUseId: 't', text: 'x', isError: false })).toBeUndefined()
    expect(progressLine({ type: 'assistant_text', messageId: 'm', delta: 'x' })).toBeUndefined()
    expect(progressLine({ type: 'ended' })).toBeUndefined()
  })
})

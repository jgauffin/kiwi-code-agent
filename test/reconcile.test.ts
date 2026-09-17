import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { RECONCILE_TOOLS, progressLine, reconcileKickoff, reconcilePrompt, reconcileScope } from '../src/agent/phases/reconcile'
import { blindPlanPrompt, decisionsHandoffPrompt, docsReviewPrompt, rulingsHandoffPrompt } from '../src/agent/phases/blind-plan'

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

  it('only_the_decisions_and_the_tasks_are_writable_so_the_spec_stays_the_planners_and_nothing_leaks_into_code_or_docs', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.decisions.md' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: 'plan/order-cancellation.tasks.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'src/Orders/OrderService.cs' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.spec.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.review.md' })).toMatchObject({ deny: expect.any(String) })
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
    expect(prompt).toContain('plan/order-cancellation.decisions.md')
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
    expect(RECONCILE_TOOLS).toEqual(['Read', 'Glob', 'Grep', 'JsonSchema', 'JsonQuery', 'Edit', 'Write', 'Skill'])
  })

  it('a_run_continuing_the_last_mapping_is_told_the_spec_changed_and_keeps_what_it_read', () => {
    const fresh = reconcileKickoff(false)
    expect(fresh).toContain('Map the spec against the code')
    const again = reconcileKickoff(true)
    expect(again).toContain('changed since you mapped it')
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
    expect(prompt).toContain('not what the spec should say instead, not the task')
    // The example is at the target length, since the example is what gets copied.
    expect(prompt).toContain('- finding: `Order.cancel` in src/orders/order.ts refuses a shipped order; the spec cancels one and refunds it.')
    expect(prompt).not.toContain('what the task would be')
    expect(prompt).not.toContain('what the spec should say instead)')
  })

  it('the_proposals_and_the_ruling_belong_to_others_and_the_run_ends_silently', () => {
    expect(prompt).toContain('The `proposed` lines are the planner\'s and the `ruling` line is the user\'s')
    expect(prompt).toContain('The spec is not yours to write')
    expect(prompt).toContain('When both files are written, stop.')
    expect(prompt).not.toContain('summarise')
  })

  it('writes_the_task_board_with_files_after_the_decisions_and_leaves_the_implementers_markers_alone', () => {
    expect(prompt).toContain('plan/order-cancellation.tasks.md')
    expect(prompt).toContain('- files:')
    expect(prompt).toContain('(new)')
    expect(prompt).toContain('[in progress]')
    expect(prompt).toContain('[tested]')
    // A task under an unruled decision would pre-empt the ruling.
    expect(prompt).toContain('No task for what a pending decision puts in question')
  })

  it('starts_from_one_task_per_scenario_under_its_heading_and_covers_every_rule', () => {
    expect(prompt).toContain('One task per scenario is the default')
    expect(prompt).toContain('## Cancelling an order\n- **Cancel command** (Cancel command, Shipped order, Refund)')
    expect(prompt).toContain('`## Foundation`')
    expect(prompt).toContain('Every rule and edge case of the spec is delivered by some task')
    expect(prompt).toContain('proves:')
    // The reading the run did is handed on, so the implementer does not do it again.
    expect(prompt).toContain('- context:')
    expect(prompt).toContain('would otherwise have to find again')
  })

  it('writes_a_how_block_per_task_so_the_implementer_builds_instead_of_discovering', () => {
    expect(prompt).toContain('- how:')
    expect(prompt).toContain('The `how:` block is the instruction the implementer builds from')
    // The line the person reads stays short; the detail is beneath it.
    expect(prompt).toContain('one sentence, for the person')
  })
})

describe('the handoffs to the planner', () => {
  it('names_the_decisions_to_propose_on_and_forbids_ruling', () => {
    const prompt = decisionsHandoffPrompt('Order cancellation', ['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
    expect(prompt).toContain('- Shipped orders cannot be cancelled\n- Refunds are asynchronous')
    expect(prompt).toContain('plan/order-cancellation.decisions.md')
    expect(prompt).toContain('one to three `- proposed: ...` lines')
    // A proposal is the rule's replacement text, so picking it is verbatim and the rule stays one sentence.
    expect(prompt).toContain("the rule's new text as it would stand in the spec, one sentence")
    // Keeping the rule is the wizard's own option, so the planner does not spend one on it.
    expect(prompt).toContain('do not propose it')
    expect(prompt).toContain('Change nothing else')
    expect(prompt).toContain('Then stop')
  })

  it('hands_the_rulings_over_to_be_applied_and_marked_and_says_approval_follows_the_revision', () => {
    const prompt = rulingsHandoffPrompt('Order cancellation', [
      { title: 'Shipped orders cannot be cancelled', ruling: 'a shipped order is refused' },
      { title: 'Refunds are asynchronous', ruling: 'keep' },
    ])
    expect(prompt).toContain('- Shipped orders cannot be cancelled: a shipped order is refused\n- Refunds are asynchronous: keep')
    expect(prompt).toContain('plan/order-cancellation.decisions.md')
    expect(prompt).toContain('`keep` keeps the rule as it stands')
    expect(prompt).toContain('the text of a proposal replaces the rule verbatim')
    expect(prompt).toContain('[applied]')
    expect(prompt).not.toContain('amendment')
    expect(prompt).toContain('the user approves after reading the revised spec')
  })

  it('on_approval_the_planner_lists_what_the_docs_should_now_say_and_edits_only_when_asked', () => {
    const prompt = docsReviewPrompt('Order cancellation')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('is approved')
    expect(prompt).toContain('one line per doc section')
    expect(prompt).toContain('Edit nothing')
    expect(prompt).toContain('asks you to')
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

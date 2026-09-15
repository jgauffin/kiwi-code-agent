import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import { RECONCILE_TOOLS, progressLine, reconcileKickoff, reconcilePrompt, reconcileScope } from '../src/agent/phases/reconcile'
import { blindPlanPrompt, decisionsHandoffPrompt, rulingsHandoffPrompt } from '../src/agent/phases/blind-plan'

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

  it('only_the_spec_and_the_tasks_are_writable_so_decisions_cannot_leak_into_code_or_intent', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: 'plan/order-cancellation.tasks.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'src/Orders/OrderService.cs' })).toMatchObject({ deny: expect.any(String) })
    // Intent amendments follow a ruling, and rulings go to the plan session: the check writes neither.
    expect(await use('Write', { file_path: 'plan/order-cancellation.intent.md' })).toMatchObject({ deny: expect.any(String) })
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

  it('names_the_spec_the_decisions_section_and_what_to_look_for', () => {
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('## Decisions')
    expect(prompt).toContain('- on: Cancel command, Shipped order')
    expect(prompt).toContain('- finding:')
    expect(prompt).toContain('says otherwise')
    expect(prompt).toContain('change or break')
    expect(prompt).toContain('shows to be wrong')
    expect(prompt).toContain('Titles are stable')
    expect(prompt).toContain('[withdrawn]')
    // The kind of a finding is nothing the user acts on, so it is not written into the file.
    expect(prompt).not.toContain('- kind:')
    // Amendments follow a ruling; the check writes none.
    expect(prompt).not.toContain('intent.md')
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

  it('the_spec_stands_in_for_the_docs_so_the_check_does_not_read_them_again', () => {
    expect(prompt).toContain('do not browse those docs')
    expect(prompt).toContain('docs/intent/orders.md#Cancellation')
    expect(blindPlanPrompt('Order cancellation', cwd)).toContain('ends with its citation in parentheses')
  })

  it('the_proposal_and_the_ruling_belong_to_others_and_the_run_ends_silently', () => {
    expect(prompt).toContain('The `proposed` line is the planner\'s and the `ruling` line is the user\'s')
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
    expect(prompt).toContain('`## Tasks` section left in the spec')
    // The reading the run did is handed on, so the implementer does not do it again.
    expect(prompt).toContain('- context:')
    expect(prompt).toContain('would otherwise have to find again')
  })
})

describe('the handoffs to the planner', () => {
  it('names_the_decisions_to_propose_on_and_forbids_ruling', () => {
    const prompt = decisionsHandoffPrompt('Order cancellation', ['Shipped orders cannot be cancelled', 'Refunds are asynchronous'])
    expect(prompt).toContain('- Shipped orders cannot be cancelled\n- Refunds are asynchronous')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('- proposed:')
    expect(prompt).toContain('Change nothing else')
    expect(prompt).toContain('Then stop')
  })

  it('hands_the_rulings_over_to_be_applied_and_marked_and_says_approval_follows_the_revision', () => {
    const prompt = rulingsHandoffPrompt('Order cancellation', [
      { title: 'Shipped orders cannot be cancelled', ruling: 'accepted' },
      { title: 'Refunds are asynchronous', ruling: 'keep the rule, queue the refund' },
    ])
    expect(prompt).toContain('- Shipped orders cannot be cancelled: accepted\n- Refunds are asynchronous: keep the rule, queue the refund')
    expect(prompt).toContain('`accepted` means the proposal as written')
    expect(prompt).toContain('[applied]')
    expect(prompt).toContain('intent amendment')
    expect(prompt).toContain('the user approves after reading the revised spec')
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

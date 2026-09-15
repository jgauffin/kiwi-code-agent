import { describe, expect, it } from 'vitest'
import { ScopeGuard } from '../src/agent/phases/scope-guard'
import {
  RECONCILE_TOOLS,
  assertFindingsRuled,
  findings,
  openFindings,
  progressLine,
  reconcileKickoff,
  reconcilePrompt,
  reconcileScope,
} from '../src/agent/phases/reconcile'
import { blindPlanPrompt, findingsHandoffPrompt } from '../src/agent/phases/blind-plan'

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

  it('only_the_spec_and_the_tasks_are_writable_so_findings_cannot_leak_into_code_or_intent', async () => {
    expect(await use('Write', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'plan/order-cancellation.spec.md' })).toEqual({ allow: true })
    expect(await use('Write', { file_path: 'plan/order-cancellation.tasks.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'src/Orders/OrderService.cs' })).toMatchObject({ deny: expect.any(String) })
    // A `naive` finding is also a claim about intent: the reconciler proposes the amendment, the human applies it.
    expect(await use('Write', { file_path: 'plan/order-cancellation.intent.md' })).toEqual({ allow: true })
    expect(await use('Edit', { file_path: 'docs/intent/orders.md' })).toMatchObject({ deny: expect.any(String) })
    // Rulings on findings go to the plan session; the check never answers a review.
    expect(await use('Edit', { file_path: 'plan/order-cancellation.review.md' })).toMatchObject({ deny: expect.any(String) })
  })

  it('bash_and_paths_outside_the_workspace_are_denied', async () => {
    expect(await use('Bash', { command: 'ls' })).toMatchObject({ deny: expect.any(String) })
    expect(await use('Read', { file_path: '../secrets.txt' })).toMatchObject({ deny: expect.stringContaining('outside') })
  })
})

describe('reconcile prompt', () => {
  const prompt = reconcilePrompt('Order cancellation', cwd)

  it('names_the_spec_the_findings_table_and_the_finding_kinds', () => {
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('## Findings')
    expect(prompt).toContain('| Finding | Proposed solution |')
    for (const kind of ['contradiction', 'breakage', 'naive']) expect(prompt).toContain(kind)
    expect(prompt).toContain('never renumber')
    expect(prompt).toContain('[resolved]')
    // Intent that the code proved wrong has to reach docs/, or the next blind plan repeats the assumption.
    expect(prompt).toContain('plan/order-cancellation.intent.md')
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
    expect(blindPlanPrompt('Order cancellation', cwd)).toContain('cites it in parentheses after the id')
  })

  it('the_proposed_solution_column_belongs_to_the_planner_and_the_run_ends_silently', () => {
    expect(prompt).toContain('leave it empty on a new finding')
    expect(prompt).toContain('When both files are written, stop.')
    expect(prompt).not.toContain('summarise')
  })

  it('writes_the_task_board_with_files_after_the_findings_and_leaves_the_implementers_markers_alone', () => {
    expect(prompt).toContain('plan/order-cancellation.tasks.md')
    expect(prompt).toContain('- files:')
    expect(prompt).toContain('(new)')
    expect(prompt).toContain('[in progress]')
    expect(prompt).toContain('[tested]')
    // A task under an unruled finding would pre-empt the ruling.
    expect(prompt).toContain('No task for what a finding puts in question')
  })

  it('starts_from_one_task_per_scenario_and_covers_every_item', () => {
    expect(prompt).toContain('One task per scenario is the default')
    expect(prompt).toContain('Every behaviour and edge case of the spec is delivered by some task')
    expect(prompt).toContain('proves:')
    expect(prompt).toContain('`## Tasks` section left in the spec')
    // The reading the run did is handed on, so the implementer does not do it again.
    expect(prompt).toContain('- context:')
    expect(prompt).toContain('would otherwise have to find again')
  })
})

const spec = `# Order cancellation

## Behaviour
- B1: an order can be cancelled

## Findings
| Finding | Proposed solution |
|---|---|
| F1 (contradiction, B1): OrderService.Cancel refuses shipped orders | |
| F2 (breakage, T1): the daily report counts cancelled orders [resolved] | drop it, B3 covers reports |
| F3 (naive, E1): refunds are asynchronous | E1 says refund on cancel; make it "refund is queued" |
`

describe('findings table', () => {
  it('rows_are_read_by_id_with_their_proposal_and_a_resolved_one_is_no_longer_open', () => {
    expect(findings(spec)).toEqual([
      { id: 'F1', text: '(contradiction, B1): OrderService.Cancel refuses shipped orders', proposal: '', resolved: false },
      {
        id: 'F2',
        text: '(breakage, T1): the daily report counts cancelled orders [resolved]',
        proposal: 'drop it, B3 covers reports',
        resolved: true,
      },
      {
        id: 'F3',
        text: '(naive, E1): refunds are asynchronous',
        proposal: 'E1 says refund on cancel; make it "refund is queued"',
        resolved: false,
      },
    ])
    expect(openFindings(spec).map((f) => f.id)).toEqual(['F1', 'F3'])
  })

  it('a_spec_without_the_section_has_no_findings', () => {
    expect(findings('# Orders\n\n## Behaviour\n- B1: x\n')).toEqual([])
    expect(findings('## Tasks\n| F9 | not in the findings section |\n')).toEqual([])
  })

  it('a_spec_cannot_be_approved_while_a_finding_awaits_its_ruling', () => {
    expect(() => assertFindingsRuled(spec)).toThrow(/F1, F3/)
    const ruled = '## Findings\n| Finding | Proposed solution |\n|---|---|\n| F1 (naive, B1): x [resolved] | y |\n'
    expect(() => assertFindingsRuled(ruled)).not.toThrow()
    expect(() => assertFindingsRuled('# Orders\n\n## Behaviour\n- B1: x\n')).not.toThrow()
  })
})

describe('the handoff to the planner', () => {
  it('names_the_findings_to_propose_on_and_forbids_ruling', () => {
    const prompt = findingsHandoffPrompt('Order cancellation', ['F1', 'F3'])
    expect(prompt).toContain('F1, F3')
    expect(prompt).toContain('plan/order-cancellation.spec.md')
    expect(prompt).toContain('Proposed solution')
    expect(prompt).toContain('Change nothing else')
    expect(prompt).toContain('Then stop')
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

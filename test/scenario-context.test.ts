import { describe, expect, it } from 'vitest'
import { ScenarioContextContract, contextFile, parseScenarioContext, readScenarioContext } from '../src/agent/phases/scenario-context'
import { withWorkspace, writeFiles } from './workspace-fixture'

const spec = [
  '---',
  'status: approved',
  '---',
  '# Orders',
  '',
  '## Goal',
  'Orders.',
  '',
  '## Cancelling an order',
  '- **Cancel command**: an open order can be cancelled',
  '',
  '## Refunding',
  '- **Refund on cancel**: a cancelled order is refunded',
].join('\n')

describe('scenario context file', () => {
  it('names_the_file_by_the_feature_slug_beside_the_decisions', () => {
    expect(contextFile('Order cancellation')).toBe('.kiwi/specs/order-cancellation.context.md')
  })

  it('reads_each_scenarios_files_in_the_order_written', () => {
    const { byScenario, problems } = parseScenarioContext(
      ['# Where Order cancellation is built', '', '## Cancelling an order', '- src/orders/order.ts', '- `src/orders/cancel.ts`', '', '## Refunding', '- src/refund.ts'].join('\n'),
    )
    expect([...byScenario]).toEqual([
      ['Cancelling an order', ['src/orders/order.ts', 'src/orders/cancel.ts']],
      ['Refunding', ['src/refund.ts']],
    ])
    expect(problems).toEqual([])
  })

  it('anything_but_scenario_headings_and_path_lines_is_a_problem', () => {
    const { problems } = parseScenarioContext(['- src/orphan.ts', '## Refunding', 'The refund lives in the billing module.'].join('\n'))
    expect(problems).toHaveLength(2)
  })

  it('a_missing_file_is_no_context_rather_than_an_error', async () => {
    await withWorkspace({}, async (dir) => {
      expect((await readScenarioContext(`${dir}/nothing.context.md`)).size).toBe(0)
    })
  })
})

describe('ScenarioContextContract hook', () => {
  it('reports_a_heading_that_is_no_scenario_and_a_path_that_does_not_exist_and_stays_quiet_otherwise', async () => {
    await withWorkspace({ 'specs/order-cancellation.spec.md': spec, 'src/orders/order.ts': '', 'src/refund.ts': '' }, async (dir) => {
      const hook = new ScenarioContextContract(dir, 'Order cancellation')
      const write = (file: string) => hook.postToolUse({ toolName: 'Write', input: { file_path: file }, toolUseId: 't', output: 'ok', isError: false })
      const file = contextFile('Order cancellation')

      await writeFiles(dir, { [file]: '## Cancelling an order\n- src/orders/order.ts\n\n## Refunding\n- src/refund.ts\n' })
      expect(await write(file)).toBeUndefined()

      await writeFiles(dir, { [file]: '## Cancelling orders\n- src/orders/order.ts\n\n## Refunding\n- src/refunds.ts\n' })
      const outcome = await write(file)
      expect(outcome?.additionalContext).toContain('Cancelling orders')
      expect(outcome?.additionalContext).toContain('Cancelling an order')
      expect(outcome?.additionalContext).toContain('src/refunds.ts')

      // Other files are none of the contract's business.
      await writeFiles(dir, { '.kiwi/specs/order-cancellation.decisions.md': '## Not a scenario\n' })
      expect(await write('.kiwi/specs/order-cancellation.decisions.md')).toBeUndefined()
    })
  })
})

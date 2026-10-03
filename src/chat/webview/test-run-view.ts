import type { PlanState } from '../protocol'
import { el } from './dom'

/**
 * The head of the Verify step's chat: the test run itself, which no
 * conversation shows. The run in flight, else the last one recorded, each
 * command with how it ended and the output of a failure; before the first,
 * the commands that will run. The fix run's conversation follows below it.
 */
export class TestRunView extends HTMLElement {
  update(plan: PlanState | undefined): void {
    this.replaceChildren()
    this.hidden = plan === undefined
    if (!plan) return
    const record = plan.lastVerification
    if (plan.verification?.live) this.append(el('p', 'running', plan.verification.text))
    if (!record) {
      this.append(...planned(plan.verifyCommands))
      return
    }
    const runs = record.runs
    const verdict = runs?.length === 0 ? 'no tests ran' : record.ok ? 'tests passed' : 'tests failed'
    this.append(el('p', `verdict ${runs?.length === 0 ? 'none' : record.ok ? 'ok' : 'failed'}`, `Last run, ${record.at}: ${verdict}`))
    // A record from before each command was kept says only what failed, or what ran.
    if (runs === undefined) {
      this.append(el('p', 'text', record.text))
      return
    }
    const list = el('ul', 'commands')
    for (const run of runs) {
      const item = el('li', `command ${run.ok ? 'ok' : 'failed'}`)
      item.append(el('span', 'mark', run.ok ? '✓' : '✗'), el('code', '', run.command))
      if (run.output) {
        const output = el('details', 'output')
        output.append(el('summary', '', 'output'), el('pre', '', run.output))
        item.append(output)
      }
      list.append(item)
    }
    this.append(list)
    for (const held of record.foreign ?? []) this.append(el('p', 'foreign', `${held.command} failed on ${held.files.join(', ')}: ${held.hand}`))
  }
}

/** What the first run will run, or why there is nothing. */
function planned(commands: string[]): HTMLElement[] {
  if (commands.length === 0) return [el('p', 'text', 'No run yet. The test commands are picked once the tasks name the files they touched.')]
  const list = el('ul', 'commands')
  for (const command of commands) {
    const item = el('li', 'command')
    item.append(el('code', '', command))
    list.append(item)
  }
  return [el('p', 'text', 'No run yet. Once every task is tested, these run:'), list]
}

customElements.define('test-run-view', TestRunView)

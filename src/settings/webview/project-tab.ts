import type { VerifyRule } from '../../agent/phases/verification'
import type { SettingsSnapshot } from '../protocol'

type NumberKey = 'verifyFailureBudget' | 'cleanup.functionLines' | 'cleanup.typeLines' | 'cleanup.fileLines'
import { RuleListChangedEvent, SettingSavedEvent } from './events'
import { button, el, field, heading, note, numberInput, onChange, settingsFileLink, textInput } from './fields'
import { NO_WORKSPACE_NOTE } from './permissions-tab'
import { RuleList } from './rule-list'

/** How this project is checked once a feature is built, and what the planner may not read. */
export class ProjectTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.verify, snapshot.verifyFailureBudget, snapshot.cleanup, snapshot.planIgnore, snapshot.hasWorkspace])
    if (signature === this.signature) return
    this.signature = signature
    this.replaceChildren()

    const disabled = !snapshot.hasWorkspace
    this.append(heading('Project', 'This workspace'))
    if (disabled) this.append(note(NO_WORKSPACE_NOTE))

    const rules = new VerifyRules()
    rules.update(snapshot.verify, disabled)
    const verify = el('section', 'verify')
    verify.append(
      el('h3', '', 'Verification'),
      rules,
      note('The first rule whose match covers a task’s file runs; {project} is the nearest file matching the project glob, {projectDir} its folder.'),
      this.number('Failure budget', 'verifyFailureBudget', snapshot.verifyFailureBudget, disabled, 'Consecutive failed test runs handed back to the implementer before the feature waits for you.'),
    )

    const cleanup = el('section', 'cleanup')
    cleanup.append(
      el('h3', '', 'Cleanup'),
      note('Units longer than these are split after the tests pass. 0 turns a limit off.'),
      this.number('Function lines', 'cleanup.functionLines', snapshot.cleanup.functionLines, disabled),
      this.number('Type lines', 'cleanup.typeLines', snapshot.cleanup.typeLines, disabled),
      this.number('File lines', 'cleanup.fileLines', snapshot.cleanup.fileLines, disabled),
      this.globs('Never measured', 'cleanup.ignore', snapshot.cleanup.ignore, disabled, '**/*.test.*'),
    )

    const planning = el('section', 'planning')
    planning.append(
      el('h3', '', 'Planning'),
      this.globs('Hidden from the planner', 'planIgnore', snapshot.planIgnore, disabled, 'docs/intent/drafts/**'),
      note('The blind planner reads docs/intent/** except these.'),
    )

    this.append(verify, cleanup, planning, settingsFileLink('workspace'))
  }

  private number(label: string, key: NumberKey, value: number, disabled: boolean, hint?: string): HTMLElement {
    const input = numberInput(key, value, { disabled })
    onChange(input, () => {
      const parsed = Number.parseInt(input.value, 10)
      // A blank or negative count is not a limit; the field goes back to what holds.
      if (Number.isNaN(parsed) || parsed < 0) {
        input.value = String(value)
        return
      }
      this.dispatchEvent(new SettingSavedEvent(key, parsed))
    })
    return field(label, input, hint ? { hint } : {})
  }

  private globs(label: string, key: 'cleanup.ignore' | 'planIgnore', values: string[], disabled: boolean, placeholder: string): HTMLElement {
    const wrap = el('div', 'field')
    wrap.append(el('span', 'label', label))
    const list = new RuleList()
    list.update(values, { placeholder, disabled })
    list.addEventListener(RuleListChangedEvent.type, (e) => this.dispatchEvent(new SettingSavedEvent(key, e.values)))
    wrap.append(list)
    return wrap
  }
}

/** The verify rules as rows: what files, the project file to find, the command to run. */
class VerifyRules extends HTMLElement {
  update(rules: VerifyRule[], disabled: boolean): void {
    this.replaceChildren()
    const head = el('div', 'row head')
    head.append(el('span', '', 'Files'), el('span', '', 'Project file'), el('span', '', 'Command'), el('span', ''))
    this.append(head)
    for (const rule of rules) this.append(this.row(rule, disabled))
    const add = button('Add rule', () => {
      const row = this.row({ match: '', command: '' }, disabled)
      add.before(row)
      row.querySelector('input')?.focus()
    })
    add.className = 'add'
    add.disabled = disabled
    this.append(add)
  }

  private row(rule: VerifyRule, disabled: boolean): HTMLElement {
    const row = el('div', 'row')
    const match = textInput('match', rule.match, { placeholder: 'src/**/*.ts', disabled })
    const project = textInput('project', rule.project ?? '', { placeholder: 'package.json', disabled })
    const command = textInput('command', rule.command, { placeholder: 'npm test', disabled })
    for (const input of [match, project, command]) input.addEventListener('change', () => this.report())
    const remove = button('×', () => {
      row.remove()
      this.report()
    })
    remove.className = 'remove'
    remove.title = 'Remove'
    remove.disabled = disabled
    row.append(match, project, command, remove)
    return row
  }

  private report(): void {
    const rules = [...this.querySelectorAll<HTMLElement>('.row:not(.head)')].flatMap((row) => {
      const value = (name: string) => row.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value.trim() ?? ''
      const rule: VerifyRule = { match: value('match'), command: value('command'), ...(value('project') ? { project: value('project') } : {}) }
      return rule.match && rule.command ? [rule] : []
    })
    this.dispatchEvent(new SettingSavedEvent('verify', rules))
  }
}

customElements.define('verify-rules', VerifyRules)
customElements.define('project-tab', ProjectTab)

import type { VerifyRule } from '../../agent/phases/verification'
import type { SettingsSnapshot } from '../protocol'

type NumberKey =
  | 'verifyFailureBudget'
  | 'cleanup.functionComplexity'
  | 'cleanup.functionLines'
  | 'cleanup.typeLines'
  | 'cleanup.fileLines'
  | 'cleanup.testFunctionComplexity'
  | 'cleanup.testFunctionLines'
  | 'cleanup.testTypeLines'
  | 'cleanup.testFileLines'
import { RuleListChangedEvent, SettingSavedEvent } from './events'
import { button, checkField, checkbox, el, field, heading, note, numberInput, onChange, settingsFileLink, textInput } from './fields'
import { NO_WORKSPACE_NOTE } from './permissions-tab'
import { RuleList } from './rule-list'

/** How this project is checked once a feature is built, and what the planner may not read. */
export class ProjectTab extends HTMLElement {
  private signature = ''

  update(snapshot: SettingsSnapshot): void {
    const signature = JSON.stringify([snapshot.verify, snapshot.verifyFailureBudget, snapshot.cleanup, snapshot.planIgnore, snapshot.cutCoveredDocs, snapshot.hasWorkspace])
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
      note('Every rule whose match covers a task’s file runs its test command, once per project; {project} is the nearest file matching the project glob, {projectDir} its folder, {file} the file itself. The implementer is told the test and build commands and narrows them while it works, so it may run them without a prompt. The test run never runs the build command.'),
      this.number('Failure budget', 'verifyFailureBudget', snapshot.verifyFailureBudget, disabled, 'Consecutive failed test runs handed back to the implementer before the feature waits for you.'),
    )

    const cleanup = el('section', 'cleanup')
    cleanup.append(
      el('h3', '', 'Cleanup'),
      note('Units past these are split after the tests pass. Complexity is what a function is held to: each branch and loop costs one plus how deeply it is nested. 0 turns a limit off.'),
      this.number('Function complexity', 'cleanup.functionComplexity', snapshot.cleanup.functionComplexity, disabled),
      this.number('Function lines', 'cleanup.functionLines', snapshot.cleanup.functionLines, disabled),
      this.number('Type lines', 'cleanup.typeLines', snapshot.cleanup.typeLines, disabled),
      this.number('File lines', 'cleanup.fileLines', snapshot.cleanup.fileLines, disabled),
      this.globs('Test files', 'cleanup.tests', snapshot.cleanup.tests, disabled, '**/*.test.*'),
      note('A test file stays one file per tested file, so tests get larger limits.'),
      this.number('Test function complexity', 'cleanup.testFunctionComplexity', snapshot.cleanup.testFunctionComplexity, disabled),
      this.number('Test function lines', 'cleanup.testFunctionLines', snapshot.cleanup.testFunctionLines, disabled),
      this.number('Test type lines', 'cleanup.testTypeLines', snapshot.cleanup.testTypeLines, disabled),
      this.number('Test file lines', 'cleanup.testFileLines', snapshot.cleanup.testFileLines, disabled),
      this.globs('Never measured', 'cleanup.ignore', snapshot.cleanup.ignore, disabled, '**/generated/**'),
    )

    const planning = el('section', 'planning')
    planning.append(
      el('h3', '', 'Planning'),
      this.globs('Hidden from the planner', 'planIgnore', snapshot.planIgnore, disabled, 'docs/drafts/**'),
      note('The blind planner reads docs/**, the README and every spec, except these.'),
      this.cutDocs(snapshot.cutCoveredDocs, disabled),
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

  private cutDocs(checked: boolean, disabled: boolean): HTMLElement {
    const box = checkbox('cutCoveredDocs', checked, { disabled })
    onChange(box, () => this.dispatchEvent(new SettingSavedEvent('cutCoveredDocs', box.checked)))
    return checkField('Cut docs an approved spec covers', box, 'On approval the planner cuts the doc sections the spec now holds, each edit confirmed. Off: it lists them and edits only what you ask.')
  }

  private globs(label: string, key: 'cleanup.tests' | 'cleanup.ignore' | 'planIgnore', values: string[], disabled: boolean, placeholder: string): HTMLElement {
    const wrap = el('div', 'field')
    wrap.append(el('span', 'label', label))
    const list = new RuleList()
    list.update(values, { placeholder, disabled })
    list.addEventListener(RuleListChangedEvent.type, (e) => this.dispatchEvent(new SettingSavedEvent(key, e.values)))
    wrap.append(list)
    return wrap
  }
}

/** The verify rules as rows: what files, the project file to find, the test command to run, the build command the implementer runs. */
class VerifyRules extends HTMLElement {
  update(rules: VerifyRule[], disabled: boolean): void {
    this.replaceChildren()
    const head = el('div', 'row head')
    head.append(el('span', '', 'Files'), el('span', '', 'Project file'), el('span', '', 'Test command'), el('span', '', 'Build command'), el('span', ''))
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
    const build = textInput('build', rule.build ?? '', { placeholder: 'npx tsc --noEmit -p "{projectDir}"', disabled })
    for (const input of [match, project, command, build]) input.addEventListener('change', () => this.report())
    const remove = button('×', () => {
      row.remove()
      this.report()
    })
    remove.className = 'remove'
    remove.title = 'Remove'
    remove.disabled = disabled
    row.append(match, project, command, build, remove)
    return row
  }

  private report(): void {
    const rules = [...this.querySelectorAll<HTMLElement>('.row:not(.head)')].flatMap((row) => {
      const value = (name: string) => row.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value.trim() ?? ''
      const rule: VerifyRule = {
        match: value('match'),
        command: value('command'),
        ...(value('project') ? { project: value('project') } : {}),
        ...(value('build') ? { build: value('build') } : {}),
      }
      return rule.match && rule.command ? [rule] : []
    })
    this.dispatchEvent(new SettingSavedEvent('verify', rules))
  }
}

customElements.define('verify-rules', VerifyRules)
customElements.define('project-tab', ProjectTab)

import type { CommandLine, PermissionDecision, SessionEvent } from '../../agent/session/code-session'
import { isShellTool, projectRuleFor, ruleLabel } from '../../agent/permissions/permission-rules'
import type { RememberedRules } from '../protocol'
import { editDiffView } from './edit-diff'
import { PermissionDecidedEvent } from './events'
import { fillCode } from './highlight'

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>

/** How one line of a shell call was answered; a line that already passes needs no answer. */
type LineAnswer = 'session' | 'project' | 'once' | 'deny'

/**
 * One tool permission prompt. A shell call is answered command by command,
 * each allowed for the session or the project, or denied; the call runs once
 * every command is allowed, and one denial denies it. Any other call is
 * answered as a whole. Emits the decision; the parent forwards it.
 */
export class PermissionCard extends HTMLElement {
  private request: PermissionRequest | undefined
  private lines: CommandLine[] = []
  private answers: (LineAnswer | undefined)[] = []
  private decision: PermissionDecision['kind'] | undefined
  private remembered: RememberedRules = { session: [], project: [] }

  show(request: PermissionRequest): void {
    this.request = request
    this.lines = request.commands ?? []
    this.answers = this.lines.map(() => undefined)
    this.render()
  }

  resolve(decision: PermissionDecision['kind']): void {
    this.decision = decision
    this.render()
  }

  get isResolved(): boolean {
    return this.decision !== undefined
  }

  private render(): void {
    const r = this.request
    if (!r) return
    const prompt = document.createElement('div')
    prompt.className = 'prompt'
    const title = document.createElement('strong')
    title.textContent = this.heading(r)
    prompt.appendChild(title)
    if (r.description && !isShellTool(r.toolName)) {
      const description = document.createElement('p')
      description.className = 'description'
      description.textContent = r.description
      prompt.appendChild(description)
    }
    prompt.appendChild(this.body(r))
    const outcome = document.createElement('p')
    outcome.className = 'decision'
    outcome.hidden = this.decision === undefined
    outcome.textContent = this.outcomeText()
    this.replaceChildren(prompt, outcome)
  }

  /** A shell call is named by what it is for, as the model described it; another call by its tool. */
  private heading(r: PermissionRequest): string {
    if (!isShellTool(r.toolName)) return r.title ?? r.toolName
    const described = (r.input as { description?: unknown })?.description
    return typeof described === 'string' && described.trim() ? described : (r.description ?? 'Run a command')
  }

  private body(r: PermissionRequest): HTMLElement {
    if (isShellTool(r.toolName) && this.lines.length) return this.commandList()
    // A file edit is asked about as the change it would make; a denied one shows only the outcome, nothing changed.
    const change = this.decision === 'deny' ? undefined : r.edit
    if (change) {
      const wrapper = document.createElement('div')
      wrapper.append(editDiffView(change), this.wholeCallActions(r))
      return wrapper
    }
    const input = document.createElement('pre')
    input.className = 'input'
    fillCode(input, JSON.stringify(r.input, null, 2), 'json')
    const wrapper = document.createElement('div')
    wrapper.append(input, this.wholeCallActions(r))
    return wrapper
  }

  private wholeCallActions(r: PermissionRequest): HTMLElement {
    const actions = document.createElement('div')
    actions.className = 'actions'
    if (this.decision !== undefined) return actions
    actions.appendChild(button('allow', 'Allow', () => this.decide({ kind: 'allow' })))
    const rule = projectRuleFor(r.toolName)
    if (rule) {
      const remember = button('allow-project', `Allow ${ruleLabel(rule)} for project`, () => {
        this.remembered.project.push(rule)
        this.decide({ kind: 'allow' })
      })
      remember.title = `Writes ${rule} to kiwiAgent.permissions.allow in this workspace.`
      actions.appendChild(remember)
    }
    actions.appendChild(button('deny', 'Deny', () => this.decide({ kind: 'deny' })))
    return actions
  }

  private commandList(): HTMLElement {
    const list = document.createElement('ul')
    list.className = 'commands'
    this.lines.forEach((line, index) => {
      const item = document.createElement('li')
      item.className = 'command'
      const text = document.createElement('code')
      fillCode(text, line.text, 'bash')
      item.append(text, this.lineStatus(line, index))
      list.appendChild(item)
    })
    return list
  }

  /** What the line still needs from the user, or what settled it. */
  private lineStatus(line: CommandLine, index: number): HTMLElement {
    const answer = this.answers[index]
    const settled = line.passes ? passesText(line.passes) : answer ? answerText(answer, line.rule) : undefined
    // A resolved card takes no more input; a line it never got to says nothing.
    if (settled !== undefined || this.decision !== undefined) {
      const status = document.createElement('span')
      status.className = `line-status ${answer === 'deny' ? 'denied' : 'allowed'}`
      status.textContent = settled ?? ''
      return status
    }
    const actions = document.createElement('span')
    actions.className = 'line-actions'
    if (line.rule) {
      const label = ruleLabel(line.rule)
      const session = button('allow-session', `Allow ${label} for session`, () => this.answer(index, 'session'))
      session.title = `Later calls covered by ${line.rule} pass without asking, until this session's host is restarted.`
      const project = button('allow-project', `Allow ${label} for project`, () => this.answer(index, 'project'))
      project.title = `Writes ${line.rule} to kiwiAgent.permissions.allow in this workspace.`
      actions.append(session, project)
    } else {
      const once = button('allow', 'Allow', () => this.answer(index, 'once'))
      once.title = 'Runs a command the line does not show, so it can only be allowed for this call.'
      actions.appendChild(once)
    }
    actions.appendChild(button('deny', 'Deny', () => this.answer(index, 'deny')))
    return actions
  }

  private answer(index: number, answer: LineAnswer): void {
    if (this.decision !== undefined) return
    this.answers[index] = answer
    const rule = this.lines[index]?.rule
    if (rule && answer === 'session') this.remembered.session.push(rule)
    if (rule && answer === 'project') this.remembered.project.push(rule)
    // One rule may cover several lines; answering one answers them all.
    if (rule && answer !== 'deny') {
      this.lines.forEach((line, i) => {
        if (line.rule === rule && this.answers[i] === undefined) this.answers[i] = answer
      })
    }
    if (answer === 'deny') return this.decide({ kind: 'deny' })
    const open = this.lines.some((line, i) => !line.passes && this.answers[i] === undefined)
    if (!open) return this.decide({ kind: 'allow' })
    this.render()
  }

  private decide(decision: PermissionDecision): void {
    const r = this.request
    if (!r || this.decision !== undefined) return
    const remember = this.remembered
    const decided = remember.session.length || remember.project.length ? { ...decision, remember } : decision
    this.dispatchEvent(new PermissionDecidedEvent(r.requestId, decided))
  }

  private outcomeText(): string {
    if (this.decision === undefined) return ''
    if (this.decision === 'deny') return 'Denied'
    const kept = [
      ...this.remembered.session.map((rule) => `${ruleLabel(rule)} for session`),
      ...this.remembered.project.map((rule) => `${ruleLabel(rule)} for project`),
    ]
    return kept.length ? `Allowed (${kept.join(', ')})` : 'Allowed'
  }
}

function passesText(passes: string): string {
  return passes === 'read-only' ? 'read-only' : `allowed by ${passes}`
}

function answerText(answer: LineAnswer, rule: string | undefined): string {
  switch (answer) {
    case 'session':
      return `allowed for session${rule ? `: ${ruleLabel(rule)}` : ''}`
    case 'project':
      return `allowed for project${rule ? `: ${ruleLabel(rule)}` : ''}`
    case 'once':
      return 'allowed'
    case 'deny':
      return 'denied'
  }
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.textContent = text
  element.addEventListener('click', onClick)
  return element
}

customElements.define('permission-card', PermissionCard)

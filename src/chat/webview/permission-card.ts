import { compileTemplate } from '@relax.js/core/html'
import type { CommandLine, FileEditChange, PermissionDecision, SessionEvent } from '../../agent/session/code-session'
import { projectRuleFor, ruleLabel } from '../../agent/permissions/permission-rules'
import { isShellTool } from '../../agent/permissions/tool-classes'
import type { RememberedRules } from '../protocol'
import { editDiffView, fileLink } from './edit-diff'
import { PermissionDecidedEvent } from './events'
import { fillCode } from './highlight'
import { renderMarkdown } from './markdown'

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>

/** How one line of a shell call was answered; a line that already passes needs no answer. */
type LineAnswer = 'session' | 'project' | 'once' | 'deny'

type LineRow = {
  index: number
  hasRule: boolean
  label: string
  settled: boolean
  status: string
  statusClass: string
  sessionTitle: string
  projectTitle: string
  allowTitle: string
}

/**
 * One tool permission prompt. A shell call is answered command by command,
 * each allowed for the session or the project, or denied; the call runs once
 * every command is allowed, and one denial denies it. Any other call is
 * answered as a whole. Emits the decision; the parent forwards it.
 */
export class PermissionCard extends HTMLElement {
  /**
   * The deny reason carries no `value` binding, so answering one command leaves
   * what the user has typed, and their caret, alone. It is read from the field
   * when the decision goes out.
   */
  private readonly template = compileTemplate(`
    <pre class="command" if="settled"></pre>
    <div class="prompt" unless="settled">
      <strong>{{heading}}</strong>
      <p class="description" if="hasDescription">{{description}}</p>
      <p class="reason" if="hasReason">{{reason}}</p>
      <ul class="commands" if="isShell">
        <li loop="l in lines" class="command">
          <code></code>
          <span class="line-status {{l.statusClass}}" if="l.settled">{{l.status}}</span>
          <span class="line-actions" unless="l.settled">
            <button type="button" class="allow-session" if="l.hasRule" title="{{l.sessionTitle}}" r-click="answerLine(l, 'session')">Allow {{l.label}} for session</button>
            <button type="button" class="allow-project" if="l.hasRule" title="{{l.projectTitle}}" r-click="answerLine(l, 'project')">Allow {{l.label}} for project</button>
            <button type="button" class="allow" unless="l.hasRule" title="{{l.allowTitle}}" r-click="answerLine(l, 'once')">Allow</button>
            <button type="button" class="deny" r-click="answerLine(l, 'deny')">Deny</button>
          </span>
        </li>
      </ul>
      <div class="actions" if="askedAnyway">
        <button type="button" class="allow" r-click="allowWhole('once')">Allow</button>
        <button type="button" class="deny" r-click="denyWhole()">Deny</button>
      </div>
      <div class="whole" unless="isShell">
        <div class="body"></div>
        <div class="actions" if="pending">
          <button type="button" class="allow-session" if="wholeRule" title="{{sessionTitle}}" r-click="allowWhole('session')">Allow {{wholeLabel}} for session</button>
          <button type="button" class="allow-project" if="wholeRule" title="{{projectTitle}}" r-click="allowWhole('project')">Allow {{wholeLabel}} for project</button>
          <button type="button" class="allow" unless="wholeRule" r-click="allowWhole('once')">Allow</button>
          <button type="button" class="deny" r-click="denyWhole()">Deny</button>
        </div>
      </div>
      <input type="text" class="deny-reason" placeholder="Reason if denied (optional)" if="pending">
    </div>
    <p class="decision" unless="settled" hidden="{{pending}}">{{outcome}}</p>
  `)
  private request: PermissionRequest | undefined
  private lines: CommandLine[] = []
  private answers: (LineAnswer | undefined)[] = []
  private decision: PermissionDecision['kind'] | undefined
  private remembered: RememberedRules = { session: [], project: [] }
  /** Only ever what the host reports back, since the field itself is gone by then. */
  private reason = ''
  private filled = false

  show(request: PermissionRequest): void {
    this.request = request
    this.lines = request.commands ?? []
    this.answers = this.lines.map(() => undefined)
    this.render()
  }

  resolve(decision: PermissionDecision['kind'], message?: string): void {
    this.decision = decision
    this.reason = message ?? ''
    this.render()
  }

  get isResolved(): boolean {
    return this.decision !== undefined
  }

  /** The call this prompt is about, when the engine named it. */
  get toolUseId(): string | undefined {
    return this.request?.toolUseId
  }

  private render(): void {
    const r = this.request
    if (!r) return
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    // Once every command is allowed there is nothing left to answer: the call reads as the command it runs.
    const settled = this.decision === 'allow' && isShellTool(r.toolName)
    const isShell = isShellTool(r.toolName) && this.lines.length > 0
    // A tool is allowed as a whole, whatever its arguments; a file write per call, the session's "Allow writes" covers the rest.
    // A plan is answered for itself: a remembered rule would wave the next plan through unread.
    const wholeRule = isShell || planText(r) !== undefined ? undefined : projectRuleFor(r.toolName)
    // The engine may ask on its own account about a call every rule lets through; no line is left to answer, so the call is.
    const askedAnyway = isShell && this.decision === undefined && this.lines.every((line) => line.passes)
    this.classList.toggle('allowed', settled)
    this.template.render(
      {
        settled,
        heading: this.heading(r),
        hasDescription: Boolean(r.description) && !isShellTool(r.toolName),
        description: r.description ?? '',
        hasReason: Boolean(r.reason),
        reason: r.reason ?? '',
        isShell,
        askedAnyway,
        lines: this.lines.map((line, index) => this.lineRow(line, index)),
        wholeRule: wholeRule ?? '',
        wholeLabel: wholeRule ? ruleLabel(wholeRule) : '',
        sessionTitle: `Later calls of ${wholeRule} pass without asking, for as long as this session lasts.`,
        projectTitle: `Writes ${wholeRule} to kiwiAgent.permissions.allow in this workspace.`,
        pending: this.decision === undefined,
        outcome: this.outcomeText(),
      },
      {
        answerLine: (l: LineRow, answer: LineAnswer) => this.answer(l.index, answer),
        allowWhole: (scope: 'session' | 'project') => {
          if (wholeRule) this.remembered[scope].push(wholeRule)
          this.decide({ kind: 'allow' })
        },
        denyWhole: () => this.decide({ kind: 'deny' }),
      },
    )
    this.fill(r, settled, isShell)
  }

  /**
   * Highlighted code and diffs the template does not own: each command line, the
   * complete command once the call settles, and the change a file edit asks
   * about. Filled once, since none of it changes as the card is answered.
   */
  private fill(r: PermissionRequest, settled: boolean, isShell: boolean): void {
    if (settled) {
      const command = this.querySelector<HTMLElement>('pre.command')
      if (command?.childElementCount === 0) fillCode(command, (r.input as { command?: unknown })?.command?.toString() ?? '', 'bash')
      return
    }
    if (this.filled) return
    this.filled = true
    if (isShell) {
      this.querySelectorAll<HTMLElement>('li.command > code').forEach((code, index) => fillCode(code, this.lines[index]?.text ?? '', 'bash'))
      return
    }
    // A file edit is asked about as the change it would make, and a plan as the plan, decided or not:
    // their arguments are never what the user answers.
    const plan = planText(r)
    this.querySelector('div.body')?.appendChild(
      r.edits ? changeList(r.edits) : r.edit ? editDiffView(r.edit) : plan !== undefined ? planView(plan) : jsonInput(r.input),
    )
  }

  /** A shell call is named by what it is for, as the model described it; another call by its tool. */
  private heading(r: PermissionRequest): string {
    if (planText(r) !== undefined) return 'Proceed with this plan?'
    if (!isShellTool(r.toolName)) return r.title ?? r.toolName
    const described = (r.input as { description?: unknown })?.description
    return typeof described === 'string' && described.trim() ? described : (r.description ?? 'Run a command')
  }

  /** What the line still needs from the user, or what settled it. */
  private lineRow(line: CommandLine, index: number): LineRow {
    const answer = this.answers[index]
    const settled = line.passes ? passesText(line.passes) : answer ? answerText(answer, line.rule) : undefined
    return {
      index,
      hasRule: Boolean(line.rule),
      label: line.rule ? ruleLabel(line.rule) : '',
      // A resolved card takes no more input; a line it never got to says nothing.
      settled: settled !== undefined || this.decision !== undefined,
      status: settled ?? '',
      statusClass: answer === 'deny' ? 'denied' : 'allowed',
      sessionTitle: `Later calls covered by ${line.rule} pass without asking, for as long as this session lasts.`,
      projectTitle: `Writes ${line.rule} to kiwiAgent.permissions.allow in this workspace.`,
      allowTitle: 'Runs a command the line does not show, so it can only be allowed for this call.',
    }
  }

  private answer(index: number, answer: LineAnswer): void {
    if (this.decision !== undefined) return
    this.answers[index] = answer
    const rule = this.lines[index]?.rule
    if (rule && (answer === 'session' || answer === 'project')) this.remembered[answer].push(rule)
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
    const message = this.querySelector<HTMLInputElement>('input.deny-reason')?.value.trim() ?? ''
    const reasoned = decision.kind === 'deny' && message ? { ...decision, message } : decision
    const decided = remember.session.length || remember.project.length ? { ...reasoned, remember } : reasoned
    this.dispatchEvent(new PermissionDecidedEvent(r.requestId, decided))
  }

  private outcomeText(): string {
    if (this.decision === undefined) return ''
    if (this.decision === 'deny') return this.reason ? `Denied: ${this.reason}` : 'Denied'
    const kept = [
      ...this.remembered.session.map((rule) => `${ruleLabel(rule)} for session`),
      ...this.remembered.project.map((rule) => `${ruleLabel(rule)} for project`),
    ]
    return kept.length ? `Allowed (${kept.join(', ')})` : 'Allowed'
  }
}

/** Several files' changes, each under its file, asked about as one. */
function changeList(edits: FileEditChange[]): HTMLElement {
  const list = document.createElement('div')
  list.className = 'changes'
  for (const change of edits) {
    const item = document.createElement('div')
    item.className = 'change'
    item.append(fileLink(change), editDiffView(change))
    list.appendChild(item)
  }
  return list
}

/** The plan a model asks to leave planning with, as the markdown it wrote. */
function planText(r: PermissionRequest): string | undefined {
  if (r.toolName !== 'ExitPlanMode') return undefined
  const plan = (r.input as { plan?: unknown } | null)?.plan
  return typeof plan === 'string' && plan.trim() ? plan : undefined
}

function planView(plan: string): HTMLElement {
  const article = document.createElement('article')
  article.className = 'plan'
  renderMarkdown(plan, article, true)
  return article
}

function jsonInput(input: unknown): HTMLElement {
  const pre = document.createElement('pre')
  pre.className = 'input'
  fillCode(pre, JSON.stringify(input, null, 2), 'json')
  return pre
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

customElements.define('permission-card', PermissionCard)

import { compileTemplate } from '@relax.js/core/html'
import type { CommandLine, FileEditChange, PermissionDecision, SessionEvent } from '../../agent/session/code-session'
import { projectRuleFor, ruleLabel } from '../../agent/permissions/rule-text'
import { isShellTool } from '../../agent/permissions/tool-classes'
import type { RememberedRules } from '../protocol'
import { editDiffView, fileLink } from './edit-diff'
import { PermissionDecidedEvent } from './events'
import { fillCode } from './highlight'
import { renderMarkdown } from './markdown'

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>

/**
 * How one line of a shell call was answered; a line that already passes
 * needs no answer. A denial may be kept the same three ways an allow may.
 */
type RuleScope = 'session' | 'project' | 'person'
type DenyAnswer = 'deny' | 'deny-session' | 'deny-project' | 'deny-person'
type LineAnswer = RuleScope | 'once' | DenyAnswer

function isDenial(answer: LineAnswer): answer is DenyAnswer {
  return answer === 'deny' || answer.startsWith('deny-')
}

type LineRow = {
  index: number
  hasRule: boolean
  /** The rule names ground inside the project: offered for the workspace rather than the person. */
  showProject: boolean
  /** The rule names a folder or file outside the project: offered for the person rather than the workspace. */
  showPerson: boolean
  label: string
  settled: boolean
  status: string
  statusClass: string
  /** For a read or a write outside the project: which it is and the whole directory. Empty for any other line. */
  access: string
  effects: { text: string; cls: string }[]
  /** A change of directory: its path in parts, each one a place the answer may be kept for. Empty for any other line. */
  places: PlacePart[]
  sessionTitle: string
  projectTitle: string
  personTitle: string
  allowTitle: string
  denySessionTitle: string
  denyProjectTitle: string
  denyPersonTitle: string
}

/** One part of a directory's path: the text it adds to the part above, and whether the chosen place reaches it. */
type PlacePart = { place: number; text: string; cls: string; title: string }

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
      <ul class="commands" if="hasLines">
        <li loop="l in lines" class="command">
          <code></code>
          <p class="access" if="l.access">{{l.access}}</p>
          <ul class="effects" if="l.effects.length">
            <li loop="e in l.effects" class="{{e.cls}}">{{e.text}}</li>
          </ul>
          <p class="places" if="l.places.length">
            <button loop="p in l.places" type="button" class="place {{p.cls}}" title="{{p.title}}" r-click="choosePlace(l, p)">{{p.text}}</button>
          </p>
          <span class="line-status {{l.statusClass}}" if="l.settled">{{l.status}}</span>
          <span class="line-actions" unless="l.settled">
            <button type="button" class="allow" autofocus title="{{l.allowTitle}}" r-click="answerLine(l, 'once')">Allow</button>
            <button type="button" class="allow-session" if="l.hasRule" title="{{l.sessionTitle}}" r-click="answerLine(l, 'session')">Allow {{l.label}} for session</button>
            <button type="button" class="allow-project" if="l.showProject" title="{{l.projectTitle}}" r-click="answerLine(l, 'project')">Allow {{l.label}} for project</button>
            <button type="button" class="allow-person" if="l.showPerson" title="{{l.personTitle}}" r-click="answerLine(l, 'person')">Allow {{l.label}} for me</button>
            <button type="button" class="deny" r-click="answerLine(l, 'deny')">Deny</button>
            <button type="button" class="deny-session" if="l.hasRule" title="{{l.denySessionTitle}}" r-click="answerLine(l, 'deny-session')">Deny {{l.label}} for session</button>
            <button type="button" class="deny-project" if="l.showProject" title="{{l.denyProjectTitle}}" r-click="answerLine(l, 'deny-project')">Deny {{l.label}} for project</button>
            <button type="button" class="deny-person" if="l.showPerson" title="{{l.denyPersonTitle}}" r-click="answerLine(l, 'deny-person')">Deny {{l.label}} for me</button>
          </span>
        </li>
      </ul>
      <div class="actions" if="askedAnyway">
        <button type="button" class="allow" autofocus r-click="allowWhole('once')">Allow</button>
        <button type="button" class="deny" r-click="denyWhole()">Deny</button>
      </div>
      <div class="whole" unless="isShell">
        <div class="body"></div>
        <div class="actions" if="askedAsAWhole">
          <button type="button" class="allow" autofocus r-click="allowWhole('once')">Allow</button>
          <button type="button" class="allow-session" if="wholeRule" title="{{sessionTitle}}" r-click="allowWhole('session')">Allow {{wholeLabel}} for session</button>
          <button type="button" class="allow-project" if="wholeRule" title="{{projectTitle}}" r-click="allowWhole('project')">Allow {{wholeLabel}} for project</button>
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
  /** For a change of directory, which of its places the answer is kept for; the directory itself until the user picks another. */
  private chosen: number[] = []
  private decision: PermissionDecision['kind'] | undefined
  private remembered: RememberedRules = { session: [], project: [], person: [] }
  /** The same three scopes, for a line denied and kept rather than allowed. */
  private deniedRemembered: RememberedRules = { session: [], project: [], person: [] }
  /** Only ever what the host reports back, since the field itself is gone by then. */
  private reason = ''
  private filled = false

  show(request: PermissionRequest): void {
    this.request = request
    this.lines = request.commands ?? []
    this.answers = this.lines.map(() => undefined)
    this.chosen = this.lines.map(() => 0)
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
        hasLines: this.lines.length > 0,
        // A call answered place by place has no whole-call buttons beside its lines.
        askedAsAWhole: this.decision === undefined && this.lines.length === 0,
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
        choosePlace: (l: LineRow, p: PlacePart) => {
          this.chosen[l.index] = p.place
          this.render()
        },
        allowWhole: (scope: 'session' | 'project' | 'once') => {
          if (wholeRule && scope !== 'once') this.remembered[scope].push(wholeRule)
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
    this.querySelectorAll<HTMLElement>('li.command > code').forEach((code, index) => fillCode(code, this.lines[index]?.text ?? '', 'bash'))
    if (isShell) return
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
    const rule = this.ruleOf(index)
    const settled = line.passes ? passesText(line.passes) : answer ? answerText(answer, rule) : undefined
    const isSettled = settled !== undefined || this.decision !== undefined
    return {
      index,
      hasRule: Boolean(rule),
      // Ground inside the project is the workspace's to keep; a folder or file outside it is the person's.
      showProject: Boolean(rule) && line.scope !== 'person',
      showPerson: Boolean(rule) && line.scope === 'person',
      // The parts above say which directory; the buttons need only say what kind of place it is.
      label: line.places ? 'directory' : rule ? ruleLabel(rule) : '',
      // A resolved card takes no more input; a line it never got to says nothing.
      settled: isSettled,
      status: settled ?? '',
      statusClass: answer === 'deny' || answer?.startsWith('deny-') ? 'denied' : 'allowed',
      // A copy or move names each place it touches; the one still unanswered is why the line is asked.
      access: isSettled ? '' : accessText(line.access),
      effects: isSettled ? [] : (line.effects ?? []).map((e) => ({ text: `${e.kind} ${e.path}`, cls: e.asked ? 'asked' : '' })),
      places: isSettled ? [] : this.placeParts(line, index),
      sessionTitle: `Later calls covered by ${rule} pass without asking, for as long as this session lasts.`,
      projectTitle: `Writes ${rule} to kiwiAgent.permissions.allow in this workspace.`,
      personTitle: `Keeps ${rule} for you, honoured in every workspace that reaches the same ground.`,
      allowTitle: rule
        ? 'Allows this call only; the command stays unremembered.'
        : line.access
          ? 'The place depends on something this call settles when it runs, so it can only be allowed for this call.'
          : 'Runs a command the line does not show, so it can only be allowed for this call.',
      denySessionTitle: `Later calls covered by ${rule} are blocked too, for as long as this session lasts.`,
      denyProjectTitle: `Writes ${rule} to kiwiAgent.permissions.deny in this workspace.`,
      denyPersonTitle: `Keeps ${rule} denied for you, in every workspace that reaches the same ground.`,
    }
  }

  /** The rule an answer to this line keeps: for a change of directory, the one for the place chosen. */
  private ruleOf(index: number): string | undefined {
    const line = this.lines[index]
    return line?.places?.[this.chosen[index] ?? 0]?.rule ?? line?.rule
  }

  /**
   * A directory's path from its shallowest place down, each part a button
   * choosing that place: the parts the chosen place covers stand out, the
   * deeper ones do not.
   */
  private placeParts(line: CommandLine, index: number): PlacePart[] {
    const places = line.places ?? []
    const chosen = this.chosen[index] ?? 0
    return places
      .map((place, at) => {
        const above = places[at + 1]?.directory
        return {
          place: at,
          text: above === undefined ? place.directory : place.directory.slice(above.length),
          cls: at >= chosen ? 'covered' : 'beyond',
          title: `Keep the answer for ${place.directory} and everything below it.`,
        }
      })
      .reverse()
  }

  private answer(index: number, answer: LineAnswer): void {
    if (this.decision !== undefined) return
    this.answers[index] = answer
    const rule = this.ruleOf(index)
    if (isDenial(answer)) {
      if (rule && answer !== 'deny') this.deniedRemembered[answer.slice(5) as RuleScope].push(rule)
      return this.decide({ kind: 'deny' })
    }
    if (rule) this.allowRule(rule, answer)
    const open = this.lines.some((line, i) => !line.passes && this.answers[i] === undefined)
    if (!open) return this.decide({ kind: 'allow' })
    this.render()
  }

  /** One rule may cover several lines; answering one answers them all. */
  private allowRule(rule: string, answer: Exclude<LineAnswer, DenyAnswer>): void {
    if (answer !== 'once') this.remembered[answer].push(rule)
    this.lines.forEach((_, i) => {
      if (this.ruleOf(i) === rule && this.answers[i] === undefined) this.answers[i] = answer
    })
  }

  private decide(decision: PermissionDecision): void {
    const r = this.request
    if (!r || this.decision !== undefined) return
    const remember = this.remembered
    const denyRemember = this.deniedRemembered
    const message = this.querySelector<HTMLInputElement>('input.deny-reason')?.value.trim() ?? ''
    const reasoned = decision.kind === 'deny' && message ? { ...decision, message } : decision
    const kept = remember.session.length || remember.project.length || remember.person.length
    const keptDeny = denyRemember.session.length || denyRemember.project.length || denyRemember.person.length
    const decided = { ...reasoned, ...(kept ? { remember } : {}), ...(keptDeny ? { denyRemember } : {}) }
    this.dispatchEvent(new PermissionDecidedEvent(r.requestId, decided))
  }

  private outcomeText(): string {
    if (this.decision === undefined) return ''
    if (this.decision === 'deny') return this.reason ? `Denied: ${this.reason}` : 'Denied'
    const kept = [
      ...this.remembered.session.map((rule) => `${ruleLabel(rule)} for session`),
      ...this.remembered.project.map((rule) => `${ruleLabel(rule)} for project`),
      ...this.remembered.person.map((rule) => `${ruleLabel(rule)} for me`),
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

/** What the call would do outside the project, in the words the person answers: read in a directory, or write to it. */
function accessText(access: CommandLine['access']): string {
  if (!access) return ''
  const doing = access.kind === 'reads' ? 'Reads in' : 'Writes to'
  return access.directory === undefined ? `${doing} a place this call decides when it runs` : `${doing} ${access.directory}`
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
    case 'person':
      return `allowed for me${rule ? `: ${ruleLabel(rule)}` : ''}`
    case 'once':
      return 'allowed'
    case 'deny':
      return 'denied'
    case 'deny-session':
      return `denied for session${rule ? `: ${ruleLabel(rule)}` : ''}`
    case 'deny-project':
      return `denied for project${rule ? `: ${ruleLabel(rule)}` : ''}`
    case 'deny-person':
      return `denied for me${rule ? `: ${ruleLabel(rule)}` : ''}`
  }
}

customElements.define('permission-card', PermissionCard)

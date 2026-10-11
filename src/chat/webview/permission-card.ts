import { compileTemplate } from '@relax.js/core/html'
import type { FileEditChange, PermissionDecision, PermissionRow, SessionEvent } from '../../agent/session/code-session'
import type { KeepOffer } from '../../agent/permissions/evaluator'
import { grantSentence } from '../../agent/permissions/grant-sentence'
import type { Grant, GrantScope, KeptGrant } from '../../agent/permissions/grants'
import type { Reach } from '../../agent/permissions/places'
import { isShellTool } from '../../agent/permissions/tool-classes'
import { editDiffView, fileLink } from './edit-diff'
import { PermissionDecidedEvent } from './events'
import { fillCode } from './highlight'
import { renderMarkdown } from './markdown'

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>

/** How one asked row is answered: by the card's Allow or Deny for this call alone, or kept as a grant. */
type RowChoice = 'call' | 'allow-keep' | 'deny-keep'

/** One asked row's answer as the person builds it. */
type RowAnswer = { choice: RowChoice; place: number; reach: Reach; scope: GrantScope; flags: Set<string> }

const SCOPE_LABEL: Record<GrantScope, string> = { session: 'this session', workspace: 'this workspace', person: 'every workspace (you)' }
const REACH_LABEL: Record<Reach, string> = { file: 'this file', directory: 'this folder only', tree: 'and every folder below it' }

/**
 * One tool permission prompt. The call is listed as what it would do, one row
 * per effect, each on one line; rows that already pass are shown quiet. The
 * card's Allow and Deny answer every asked row for this call alone, so the
 * quick answer stays one click. A row opened with Keep… is kept as a grant
 * instead, built from parts the place allows, with the sentence it will be
 * kept as shown before it is given. The call runs only when every row is
 * allowed; kept answers go out either way.
 */
export class PermissionCard extends HTMLElement {
  /** The deny reason carries no `value` binding, so re-rendering leaves what the user typed alone. */
  private readonly template = compileTemplate(`
    <pre class="command" if="settled"></pre>
    <div class="prompt" unless="settled">
      <strong>{{heading}}</strong>
      <p class="description" if="hasDescription">{{description}}</p>
      <p class="reason" if="hasReason">{{reason}}</p>
      <pre class="call" if="isShell"></pre>
      <div class="body" unless="isShell"></div>
      <ul class="rows"></ul>
      <input type="text" class="deny-reason" placeholder="Reason if denied (optional)" if="pending">
      <div class="actions" if="pending">
        <button type="button" class="confirm" autofocus r-click="confirm()">{{confirmLabel}}</button>
        <button type="button" class="keep-session" if="plain" title="{{sessionSentence}}" r-click="keepForSession()">Allow for this session</button>
        <button type="button" class="keep-workspace" if="plain" title="{{workspaceSentence}}" r-click="keepForWorkspace()">Allow for this workspace</button>
        <button type="button" class="deny" if="canDeny" r-click="denyAll()">Deny</button>
      </div>
    </div>
    <p class="decision" unless="settled" hidden="{{pending}}">{{outcome}}</p>
  `)
  private request: PermissionRequest | undefined
  private rows: PermissionRow[] = []
  private answers = new Map<number, RowAnswer>()
  private decision: PermissionDecision['kind'] | undefined
  private kept: KeptGrant[] = []
  /** Only ever what the host reports back, since the field itself is gone by then. */
  private reason = ''
  private filled = false

  show(request: PermissionRequest): void {
    this.request = request
    this.rows = request.rows ?? []
    this.answers = new Map(
      this.rows.flatMap((row, index) => (row.verdict === 'asked' && row.keep ? [[index, firstAnswer(row.keep)] as const] : [])),
    )
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
    const isShell = isShellTool(r.toolName)
    const settled = this.decision === 'allow' && isShell
    this.classList.toggle('allowed', settled)
    this.template.render(
      {
        settled,
        heading: heading(r),
        hasDescription: Boolean(r.description) && !isShell && !repeatsInput(r.description ?? '', r.input),
        description: r.description ?? '',
        hasReason: Boolean(r.reason),
        reason: r.reason ?? '',
        isShell,
        pending: this.decision === undefined,
        confirmLabel: this.confirmLabel(),
        // Once a row is kept as a denial the confirm already refuses, and a second deny button would only repeat it.
        canDeny: !this.keepsDenial(),
        plain: this.isPlain(),
        sessionSentence: this.plainGrants('session').map((g) => grantSentence(g, g.scope)).join(' '),
        workspaceSentence: this.plainGrants('workspace').map((g) => grantSentence(g, g.scope)).join(' '),
        outcome: this.outcomeText(),
      },
      {
        confirm: () => this.confirm(),
        keepForSession: () => this.decide({ kind: 'allow' }, this.plainGrants('session')),
        keepForWorkspace: () => this.decide({ kind: 'allow' }, this.plainGrants('workspace')),
        denyAll: () => this.decide({ kind: 'deny' }, this.keptGrants()),
      },
    )
    this.fill(r, settled, isShell)
    this.renderRows()
  }

  /** Highlighted code and diffs the template does not own, filled once since none of it changes as the card is answered. */
  private fill(r: PermissionRequest, settled: boolean, isShell: boolean): void {
    const command = (r.input as { command?: unknown })?.command?.toString() ?? ''
    if (settled) {
      const pre = this.querySelector<HTMLElement>('pre.command')
      if (pre?.childElementCount === 0) fillCode(pre, command, 'bash')
      return
    }
    if (this.filled) return
    this.filled = true
    if (isShell) {
      const pre = this.querySelector<HTMLElement>('pre.call')
      if (pre) fillCode(pre, command, 'bash')
      return
    }
    // A file edit is asked about as the change it would make, and a plan as the plan: their arguments are never what the user answers.
    const plan = planText(r)
    this.querySelector('div.body')?.appendChild(r.edits ? changeList(r.edits) : r.edit ? editDiffView(r.edit) : plan !== undefined ? planView(plan) : inputView(r.input))
  }

  /** Every row: those that pass collapsed, those refused said, those asked with their answer and the sentence it keeps. */
  private renderRows(): void {
    const list = this.querySelector<HTMLUListElement>('ul.rows')
    if (!list) return
    list.replaceChildren(...this.rows.map((row, index) => this.rowItem(row, index)))
  }

  private rowItem(row: PermissionRow, index: number): HTMLLIElement {
    const item = document.createElement('li')
    item.className = `row ${row.verdict}`
    const head = document.createElement('div')
    head.className = 'does'
    head.append(text('span', 'what', row.does), text('span', 'why', row.verdict === 'passes' ? `✓ ${row.reason}` : row.verdict === 'refused' ? `refused: ${row.reason}` : row.reason))
    item.append(head)
    const answer = this.answers.get(index)
    if (row.verdict !== 'asked' || !row.keep || !answer || this.decision !== undefined || this.isPlain()) return item
    if (!canKeep(row.keep)) {
      if (row.keep.allowNever) item.append(text('p', 'never', row.keep.allowNever))
      return item
    }
    if (answer.choice === 'call') {
      const open = text('button', 'keep', keepLabel(row.keep))
      open.type = 'button'
      open.title = 'Keep an answer for this, so it is not asked again'
      open.addEventListener('click', () => this.change(index, { choice: row.keep!.allowNever === undefined ? 'allow-keep' : 'deny-keep' }))
      head.append(open)
      return item
    }
    item.append(this.answerParts(row.keep, answer, index))
    return item
  }

  /** A kept answer for one row: allow or deny, the parts of the grant, and the sentence they make. */
  private answerParts(keep: KeepOffer, answer: RowAnswer, index: number): HTMLElement {
    const parts = document.createElement('div')
    parts.className = 'answer'
    const choices: [RowChoice, string, boolean][] = [
      ['allow-keep', 'Allow and keep', keep.allowNever === undefined],
      ['deny-keep', 'Deny and keep', true],
      ['call', "Don't keep", true],
    ]
    const group = document.createElement('div')
    group.className = 'choices'
    for (const [value, label, offered] of choices) {
      if (!offered) continue
      const option = document.createElement('label')
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = `${this.request?.requestId ?? ''}-${index}`
      radio.checked = answer.choice === value
      radio.addEventListener('change', () => this.change(index, { choice: value }))
      option.append(radio, ` ${label}`)
      group.append(option)
    }
    parts.append(group)
    if (keep.allowNever) parts.append(text('p', 'never', keep.allowNever))
    parts.append(this.grantParts(keep, answer, index))
    parts.append(text('p', 'sentence', this.sentenceOf(keep, answer)))
    return parts
  }

  /** The place, how far below it, the scope, and on a deny the flags. */
  private grantParts(keep: KeepOffer, answer: RowAnswer, index: number): HTMLElement {
    const box = document.createElement('div')
    box.className = 'grant-parts'
    const place = keep.places[answer.place]!
    box.append(
      select(keep.places.map((p, i) => [String(i), p.place]), String(answer.place), (v) => this.change(index, { place: Number(v), reach: keep.places[Number(v)]!.reaches[0]! })),
      select(place.reaches.map((r) => [r, REACH_LABEL[r]]), answer.reach, (v) => this.change(index, { reach: v as Reach })),
      text('span', '', 'for'),
      select(keep.scopes.map((s) => [s, SCOPE_LABEL[s]]), answer.scope, (v) => this.change(index, { scope: v as GrantScope })),
    )
    if (answer.choice === 'deny-keep' && keep.flags.length > 0) {
      const flags = document.createElement('span')
      flags.className = 'flags'
      flags.append('only with ')
      for (const flag of keep.flags) {
        const label = document.createElement('label')
        const box = document.createElement('input')
        box.type = 'checkbox'
        box.checked = answer.flags.has(flag)
        box.addEventListener('change', () => {
          const next = new Set(answer.flags)
          if (box.checked) next.add(flag)
          else next.delete(flag)
          this.change(index, { flags: next })
        })
        label.append(box, ` ${flag}`)
        flags.append(label)
      }
      box.append(flags)
    }
    return box
  }

  private change(index: number, patch: Partial<RowAnswer>): void {
    const current = this.answers.get(index)
    if (!current || this.decision !== undefined) return
    this.answers.set(index, { ...current, ...patch })
    this.render()
  }

  /** The sentence a kept answer will be kept as. */
  private sentenceOf(keep: KeepOffer, answer: RowAnswer): string {
    const grant = grantOf(keep, answer)
    return grant ? `From now on: ${grantSentence(grant, answer.scope)}` : ''
  }

  /** Every asked row a command run in the workspace: the card answers with plain buttons, nothing to pick. */
  private isPlain(): boolean {
    const asked = this.rows.filter((row) => row.verdict === 'asked')
    return asked.length > 0 && asked.every((row) => row.keep?.plain === true && canKeep(row.keep))
  }

  /** Each asked command kept anywhere in the workspace: the widest place offered, and everything below it. */
  private plainGrants(scope: GrantScope): KeptGrant[] {
    if (!this.isPlain()) return []
    return this.rows.flatMap((row) => {
      const keep = row.keep
      const place = keep?.places.at(-1)
      if (row.verdict !== 'asked' || !keep || !place || !('command' in keep.subject)) return []
      return [{ verdict: 'allow' as const, command: keep.subject.command, place: place.place, reach: 'tree' as const, scope }]
    })
  }

  private keepsDenial(): boolean {
    return [...this.answers.values()].some((a) => a.choice === 'deny-keep')
  }

  private confirmLabel(): string {
    if (this.isPlain()) return 'Allow once'
    if (this.keepsDenial()) return this.rows.length > 1 ? 'Refuse the line' : 'Deny and keep'
    return [...this.answers.values()].some((a) => a.choice === 'allow-keep') ? 'Allow and keep' : 'Allow'
  }

  /** Every grant the rows opened with Keep… make. */
  private keptGrants(): KeptGrant[] {
    const kept: KeptGrant[] = []
    for (const [index, answer] of this.answers) {
      const keep = this.rows[index]?.keep
      if (!keep || answer.choice === 'call') continue
      const grant = grantOf(keep, answer)
      if (grant) kept.push({ ...grant, scope: answer.scope })
    }
    return kept
  }

  private confirm(): void {
    this.decide({ kind: this.keepsDenial() ? 'deny' : 'allow' }, this.keptGrants())
  }

  private decide(decision: PermissionDecision, kept: KeptGrant[]): void {
    const r = this.request
    if (!r || this.decision !== undefined) return
    this.kept = kept
    const message = this.querySelector<HTMLInputElement>('input.deny-reason')?.value.trim() ?? ''
    const reasoned = decision.kind === 'deny' && message ? { ...decision, message } : decision
    this.dispatchEvent(new PermissionDecidedEvent(r.requestId, { ...reasoned, ...(kept.length ? { keep: kept } : {}) }))
  }

  private outcomeText(): string {
    if (this.decision === undefined) return ''
    const verdict = this.decision === 'deny' ? (this.reason ? `Denied: ${this.reason}` : 'Denied') : 'Allowed'
    const kept = this.kept.map((g) => grantSentence(g, g.scope))
    return kept.length ? `${verdict}. Kept: ${kept.join(' ')}` : verdict
  }
}

/**
 * A row's answer before the person changes it: this call alone, with a place
 * and the first scope ready should they keep it. A file's answer starts at the
 * folder holding it, since a folder is what a kept read or write is wanted for;
 * the file alone is one pick away.
 */
function firstAnswer(keep: KeepOffer): RowAnswer {
  const place = keep.places[0]?.reaches.join() === 'file' && keep.places.length > 1 ? 1 : 0
  return { choice: 'call', place, reach: keep.places[place]?.reaches[0] ?? 'tree', scope: firstScope(keep), flags: new Set() }
}

/** A command is kept for the workspace it is the project's to run in; a folder for the session, the narrower step. */
function firstScope(keep: KeepOffer): GrantScope {
  const command = 'command' in keep.subject && keep.allowNever === undefined
  return command && keep.scopes.includes('workspace') ? 'workspace' : (keep.scopes[0] ?? 'session')
}

/** The link that opens a row's kept answer, named for what it would keep where an allow can be kept. */
function keepLabel(keep: KeepOffer): string {
  if (keep.allowNever !== undefined) return 'Keep…'
  if ('action' in keep.subject) return keep.subject.action === 'read' ? 'Allow reads in this folder…' : 'Allow writes in this folder…'
  const command = `\`${keep.subject.command.join(' ')}\``
  return keep.scopes.includes('workspace') ? `Allow ${command} in this workspace…` : `Allow ${command}…`
}

/** Has the row a place and a scope an answer could be kept for? */
const canKeep = (keep: KeepOffer): boolean => keep.places.length > 0 && keep.scopes.length > 0

/** The grant a kept answer makes: the row's action or command at the chosen place, flags on a deny only. */
function grantOf(keep: KeepOffer, answer: RowAnswer): Grant | undefined {
  const place = keep.places[answer.place]
  if (!place) return undefined
  const verdict = answer.choice === 'deny-keep' ? 'deny' : 'allow'
  const flags = verdict === 'deny' && answer.flags.size > 0 ? { flags: [...answer.flags] } : {}
  const what = 'action' in keep.subject ? { action: keep.subject.action } : { command: keep.subject.command, ...flags }
  return { verdict, ...what, place: place.place, reach: answer.reach }
}

/** A shell call is named by what it is for, as the model described it; another call by its tool. */
function heading(r: PermissionRequest): string {
  if (planText(r) !== undefined) return 'Proceed with this plan?'
  if (!isShellTool(r.toolName)) return r.title ?? r.toolName
  const described = (r.input as { description?: unknown })?.description
  return typeof described === 'string' && described.trim() ? described : (r.description ?? 'Run a command')
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.textContent = content
  return node
}

function select(options: [string, string][], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const node = document.createElement('select')
  for (const [v, label] of options) {
    const option = document.createElement('option')
    option.value = v
    option.textContent = label
    node.append(option)
  }
  node.value = value
  node.addEventListener('change', () => onChange(node.value))
  return node
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

type Scalar = string | number | boolean

/**
 * What a tool was asked to do. Flat arguments read as labelled fields, one per
 * line, the way a person reads them; anything nested is shown as the JSON it is.
 */
function inputView(input: unknown): HTMLElement {
  const fields = typeof input === 'object' && input !== null && !Array.isArray(input) ? Object.entries(input) : []
  if (fields.length === 0 || !fields.every((entry): entry is [string, Scalar] => ['string', 'number', 'boolean'].includes(typeof entry[1]))) return jsonInput(input)
  const list = document.createElement('dl')
  list.className = 'fields'
  for (const [key, value] of fields) list.append(text('dt', '', key.replace(/_/g, ' ')), text('dd', '', String(value)))
  return list
}

function jsonInput(input: unknown): HTMLElement {
  const pre = document.createElement('pre')
  pre.className = 'input'
  fillCode(pre, JSON.stringify(input, null, 2), 'json')
  return pre
}

/** A description the engine cut from one of the arguments says nothing the fields do not. */
function repeatsInput(description: string, input: unknown): boolean {
  const stem = description.replace(/(\.\.\.|…)$/, '').trim()
  if (!stem || typeof input !== 'object' || input === null) return false
  return Object.values(input).some((value) => typeof value === 'string' && value.startsWith(stem))
}

customElements.define('permission-card', PermissionCard)

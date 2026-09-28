import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { Decision } from '../../agent/phases/decisions'
import { PlanFocusRequestedEvent } from './events'
import { PlanTab } from './plan-tab'
import { OPTIONS_MARKUP, optionRows, pickOf, type OptionRow } from './plan-ruling-options'
import { DECISION_STATE, itemNamed, MARKER, pendingDecisions, rulingText, same, type Editor } from './plan-parts'
import './markdown-text'

type RuleRow = { name: string; title: string; lead: string; text: string }
type SettledRow = { className: string; finding: string; withdrawn: boolean; ruled: boolean; ruling: string; title: string; hasOn: boolean; on: string }

const MARKUP = `
  <section class="decisions">
    <p class="note" if="empty">{{emptyText}}</p>
    <header class="wizard" if="pending">
      <span class="count">Decision {{at}} of {{of}}</span>
      <span class="left">{{left}}</span>
      <span class="nav">
        <button type="button" disabled="{{first}}" r-click="step(-1)">Previous</button>
        <button type="button" disabled="{{last}}" r-click="step(1)">Next</button>
      </span>
    </header>
    <article class="{{className}}" if="pending">
      <header class="head">
        <h3 class="title">{{title}}</h3>
        <span class="badge state {{state}}" if="badged">{{stateLabel}}</span>
      </header>
      <div class="sides">
        <div class="spec side" if="hasRules">
          <span class="kind">the spec</span>
          <span class="text">
            <!-- One line: the rule reads as one sentence, so no whitespace may come between the name, the lead-in and the text. -->
            <div loop="r in rules" class="rule"><button type="button" class="link item name" title="{{r.title}}" r-click="focus(r.name)">{{r.name}}</button>{{r.lead}}<markdown-text class="text" text="{{r.text}}"></markdown-text></div>
          </span>
        </div>
        <div class="finding side">
          <span class="kind">the code</span>
          <markdown-text class="text" text="{{finding}}"></markdown-text>
        </div>
      </div>
      <div class="awaiting" if="awaiting">waiting for the planner to propose</div>
      <div class="ruling" if="ruled">
        <span class="kind">ruling</span>
        <markdown-text class="text" text="{{ruling}}"></markdown-text>
      </div>
      <plan-editor class="editor" if="writing" label="Rule" placeholder="What should happen instead?" text="{{editorText}}"></plan-editor>
      ${OPTIONS_MARKUP}
    </article>
    <details class="history" if="settled">
      <summary>{{summary}}</summary>
      <div loop="s in history" class="{{s.className}}">
        <div class="finding">
          <span class="kind">the code</span>
          <markdown-text class="text" text="{{s.finding}}"></markdown-text>
        </div>
        <div class="awaiting" if="s.withdrawn">withdrawn: the mapping found it no longer holds</div>
        <div class="ruling" if="s.ruled">
          <span class="kind">ruled</span>
          <markdown-text class="text" text="{{s.ruling}}"></markdown-text>
        </div>
        <div class="foot">
          <span class="title">{{s.title}}</span>
          <span class="on" if="s.hasOn">on {{s.on}}</span>
        </div>
      </div>
    </details>
  </section>`

/**
 * A wizard over the decisions still in play: one at a time, both sides of the
 * disagreement and the ways to settle it as buttons, a pick moving on to the
 * next open one. Only the header steps between them, so nothing under the card
 * can be read as another way to settle this one. The settled ones are folded
 * away: an applied decision is history, its finding and ruling the record, and
 * its title no more than a footnote.
 */
export class PlanDecisionsTab extends PlanTab {
  private readonly template = compileTemplate(MARKUP)
  /** The pending decision the wizard shows, by title; the first open one when unset or gone. */
  private shown: string | undefined

  protected draw(plan: PlanState): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    const pending = pendingDecisions(plan)
    const current = pending.find((d) => this.shown !== undefined && same(d.title, this.shown)) ?? pending.find((d) => d.state === 'open') ?? pending[0]
    this.template.render(
      { ...this.frame(plan, pending, current), ...this.card(plan, current) },
      {
        focus: (name: string) => this.dispatchEvent(new PlanFocusRequestedEvent('spec', { item: name })),
        step: (by: number) => this.show(pending[pending.indexOf(current!) + by]!),
        settle: (option: OptionRow) => this.settle(current!, option),
      },
    )
  }

  /** Where the wizard stands, and the settled ones folded beneath it. */
  private frame(plan: PlanState, pending: Decision[], current: Decision | undefined) {
    const settled = plan.decisions.filter((d) => d.state === 'applied' || d.state === 'withdrawn')
    const applied = settled.filter((d) => d.state === 'applied').length
    const open = pending.filter((d) => d.state === 'open').length
    const index = current ? pending.indexOf(current) : 0
    return {
      empty: pending.length === 0,
      emptyText: settled.length > 0 ? 'Every decision is settled.' : 'The mapping found nothing in the way.',
      pending: current !== undefined,
      at: index + 1,
      of: pending.length,
      left: open === 0 ? 'all ruled' : `${open} to rule on`,
      first: index === 0,
      last: index === pending.length - 1,
      settled: settled.length > 0,
      summary: [applied > 0 ? `${applied} applied` : '', settled.length - applied > 0 ? `${settled.length - applied} withdrawn` : ''].filter(Boolean).join(', '),
      history: settled.map(settledRow),
    }
  }

  /** What the code and the spec disagree on, and the ways to settle it. */
  private card(plan: PlanState, decision: Decision | undefined) {
    const writing = this.editor?.kind === 'ruling' && decision !== undefined && same(this.editor.target, decision.title)
    // The check runs after approval, so an approved spec takes rulings; only an implemented one is settled.
    const rulable = plan.status === 'draft' || plan.status === 'approved'
    const attention = rulable && decision?.state === 'open' && decision.proposals.length > 0
    return {
      className: `decision ${decision?.state ?? 'open'}${attention ? ' attention' : ''}`,
      title: decision?.title ?? '',
      state: decision?.state ?? 'open',
      badged: decision !== undefined && decision.state !== 'open',
      stateLabel: decision ? DECISION_STATE[decision.state] : '',
      hasRules: (decision?.on.length ?? 0) > 0,
      rules: (decision?.on ?? []).map((name) => ruleRow(name, plan)),
      finding: decision?.finding ?? '',
      awaiting: decision?.proposals.length === 0 && decision.state === 'open',
      ruled: decision?.ruling !== undefined,
      ruling: decision ? rulingText(decision) : '',
      writing: rulable && writing,
      editorText: this.editor?.text ?? '',
      optioned: rulable && !writing && decision !== undefined,
      leading: decision?.state === 'open' && decision.proposals.length > 0,
      options: decision ? optionRows(decision, plan) : [],
      recommended: decision?.recommendation !== undefined,
      pick: (decision ? pickOf(decision) : undefined) ?? { which: '', lead: '', because: '' },
    }
  }

  private show(decision: Decision): void {
    this.shown = decision.title
    this.openEditor(undefined)
  }

  private settle(decision: Decision, option: OptionRow): void {
    if (option.own) this.openEditor({ kind: 'ruling', target: decision.title, text: option.ruling })
    else this.rule(decision.title, option.ruling)
  }

  /** Writes the ruling and moves the wizard on to the next open decision, the one after this first; stays when none is left. */
  private rule(title: string, ruling: string): void {
    const pending = this.plan ? pendingDecisions(this.plan) : []
    const index = pending.findIndex((d) => same(d.title, title))
    const after = pending.slice(index + 1).find((d) => d.state === 'open') ?? pending.find((d, i) => d.state === 'open' && i !== index)
    this.shown = after?.title ?? title
    this.act({ type: 'rule_decision', decision: title, ruling })
  }

  protected override saveEditor(editor: Editor, text: string): void {
    if (editor.kind === 'ruling') this.rule(editor.target, text)
    else super.saveEditor(editor, text)
  }
}

/** A rule the decision is on, as the spec has it; the name stays the link to its row. */
function ruleRow(name: string, plan: PlanState): RuleRow {
  const item = plan.spec ? itemNamed(plan.spec, name) : undefined
  return { name, title: `Concerns the rule "${name}"; opens it on the Spec tab.`, lead: item ? ': ' : '', text: item ? item.text.replace(MARKER, '').trim() : '' }
}

/** A decision that is history: the finding and what was ruled, the title beneath as the reference. */
function settledRow(decision: Decision): SettledRow {
  return {
    className: `decision settled ${decision.state}`,
    finding: decision.finding,
    withdrawn: decision.state === 'withdrawn',
    ruled: decision.state !== 'withdrawn' && decision.ruling !== undefined,
    ruling: rulingText(decision),
    title: decision.title,
    hasOn: decision.on.length > 0,
    on: decision.on.join(', '),
  }
}

customElements.define('plan-decisions-tab', PlanDecisionsTab)

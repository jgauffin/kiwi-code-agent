import type { PlanState } from '../protocol'
import type { Decision } from '../../agent/phases/decisions'
import { KEEP_RULING } from '../../agent/phases/ruling'
import { rewrittenRule, same } from './plan-parts'
import './markdown-text'

const SENT = 'Send rulings from the plan bar hands them to the planner; nothing is sent now.'

export type OptionRow = {
  className: string
  title: string
  /** The ruling a pick writes; empty on the own option, which opens the box instead. */
  ruling: string
  own: boolean
  numbered: boolean
  index: string
  kind: string
  named: boolean
  rule: string
  text: string
}

/** Which way the planner would settle it, read after every option rather than marked on one. */
export type Pick = { which: string; lead: string; because: string }

/**
 * The ways to settle a decision: change the spec one of the proposed ways,
 * keep it and change the code, or say it in the user's own words. The chosen
 * one is marked; a pick writes the ruling and moves the wizard on to the next
 * open decision. Nothing is sent until Send rulings.
 */
export const OPTIONS_MARKUP = `
  <div class="options" if="optioned">
    <h4 class="heading" if="leading">How to settle it</h4>
    <p class="lead" if="leading">The spec then reads as you pick and the code is built to it. Nothing is sent until Send rulings.</p>
    <button type="button" loop="o in options" class="{{o.className}}" title="{{o.title}}" r-click="settle(o)">
      <span class="index" if="o.numbered">{{o.index}}</span>
      <span class="kind">{{o.kind}}</span>
      <span class="rule" if="o.named">{{o.rule}}</span>
      <markdown-text class="text" text="{{o.text}}"></markdown-text>
    </button>
    <div class="recommendation" if="recommended">
      <span class="kind">recommended</span>
      <span class="text"><strong class="which">{{pick.which}}</strong>{{pick.lead}}<markdown-text class="because" text="{{pick.because}}"></markdown-text></span>
    </div>
  </div>`

const chosen = (decision: Decision, ruling: string): boolean => decision.ruling !== undefined && same(decision.ruling, ruling)

export function optionRows(decision: Decision, plan: PlanState): OptionRow[] {
  const rewrites = decision.proposals.map((p) => rewrittenRule(p, decision, plan))
  // The rule is named above, so it is worth naming on an option only when the options do not all rewrite the same one.
  const several = new Set(rewrites.filter((r) => r !== undefined).map((r) => r.name.toLowerCase())).size > 1
  const changes = decision.proposals.map((proposal, index) => changeRow(decision, proposal, index, several ? rewrites[index]?.name : undefined, rewrites[index]?.text))
  return [...changes, keepRow(decision), ownRow(decision)]
}

/** One proposed rewrite of the spec, numbered as the recommendation names it. */
function changeRow(decision: Decision, proposal: string, index: number, rule: string | undefined, text: string | undefined): OptionRow {
  return {
    className: `option change${chosen(decision, proposal) ? ' chosen' : ''}`,
    title: `Rule that the rule reads so. ${SENT}`,
    ruling: proposal,
    own: false,
    numbered: true,
    index: String(index + 1),
    kind: 'Change the spec',
    named: rule !== undefined,
    rule: rule ?? '',
    text: text ?? proposal,
  }
}

function keepRow(decision: Decision): OptionRow {
  return {
    className: `option keep${chosen(decision, KEEP_RULING) ? ' chosen' : ''}`,
    title: `The rule stands as written; the code is changed to match. ${SENT}`,
    ruling: KEEP_RULING,
    own: false,
    numbered: false,
    index: '',
    kind: 'Keep the spec',
    named: false,
    rule: '',
    text: 'the code changes',
  }
}

/** The user's own words; already chosen when the ruling matches none of the offers. */
function ownRow(decision: Decision): OptionRow {
  const ruled = decision.ruling !== undefined && !chosen(decision, KEEP_RULING) && !decision.proposals.some((p) => chosen(decision, p))
  return {
    className: `option own${ruled ? ' chosen' : ''}`,
    title: `Write the ruling in your own words. ${SENT}`,
    ruling: ruled ? decision.ruling! : '',
    own: true,
    numbered: false,
    index: '',
    kind: 'Own ruling',
    named: false,
    rule: '',
    text: ruled ? decision.ruling! : 'say what should happen',
  }
}

export function pickOf(decision: Decision): Pick | undefined {
  const pick = decision.recommendation
  if (!pick) return undefined
  return {
    which: pick.choice === 'keep' ? 'Keep the spec' : `Option ${pick.choice}`,
    lead: pick.because ? ': ' : '',
    because: pick.because ?? '',
  }
}

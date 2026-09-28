import { compileTemplate } from '@relax.js/core/html'
import type { PlanState } from '../protocol'
import type { Item, Spec } from '../../agent/phases/spec-model'
import { PlanTab } from './plan-tab'
import { commentMarkup, commentRows, type CommentRow } from './plan-comments'
import { commentsOn, MARKER, pendingDecisions, pendingRound, PLAN_TARGET, same, staleNote, struckItems, type Editor } from './plan-parts'
import { post } from './vscode-api'
import './markdown-text'

/** What builds a rule and what proves it: a gap wears a badge, what is in order is a quiet mark. */
type Coverage = { hasTask: boolean; taskName: string; taskTitle: string; noTask: boolean; hasProof: boolean; proofFile: string; proofTitle: string; noProof: boolean }
/** The comments on a target, and whether a new one is being written for it. */
type Attached = { comments: CommentRow[]; hasComments: boolean; editing: boolean; editorText: string }
type ItemRow = Coverage &
  Attached & {
    name: string
    className: string
    rest: string
    cited: boolean
    citation: string
    citationPath: string
    removed: boolean
    struckBadge: boolean
    controls: boolean
    strikeable: boolean
    unstrikeable: boolean
  }
type RuleRow = ItemRow & { hasEdges: boolean; edges: ItemRow[] }

/**
 * A rule, edge case or question: its name as the lead-in, its text, and to the
 * right what the reader needs at a glance: a gap in coverage, a strike, the
 * intent link; what is in order stays quiet, and the review controls show on
 * hover. The same markup at both levels, so the alias and the collection come
 * in; `edges` is the block for the level below, empty at the bottom.
 */
const itemMarkup = (a: string, collection: string, edges: string): string => `
  <li loop="${a} in ${collection}" class="{{${a}.className}}" data-item="{{${a}.name}}">
    <div class="line">
      <span class="text"><strong class="name">{{${a}.name}}</strong>{{${a}.rest}}</span>
      <span class="aside">
        <button type="button" class="link file citation" if="${a}.cited" title="{{${a}.citation}}" r-click="open(${a}.citationPath)">intent</button>
        <span class="badge removed" if="${a}.removed">removed</span>
        <span class="badge struck" if="${a}.struckBadge">struck</span>
        <span class="chip task" if="${a}.hasTask" title="{{${a}.taskTitle}}">{{${a}.taskName}}</span>
        <span class="badge gap" if="${a}.noTask">no task</span>
        <button type="button" class="link file chip proof" if="${a}.hasProof" title="{{${a}.proofTitle}}" r-click="open(${a}.proofFile)">✓</button>
        <span class="badge gap" if="${a}.noProof">no test</span>
        <span class="controls" if="${a}.controls">
          <button type="button" r-click="comment(${a}.name)">Comment</button>
          <button type="button" if="${a}.strikeable" r-click="strike(${a}.name)">Strike</button>
          <button type="button" if="${a}.unstrikeable" r-click="unstrike(${a}.name)">Unstrike</button>
        </span>
      </span>
    </div>
    <ul class="comments" if="${a}.hasComments">${commentMarkup(`${a}.comments`)}</ul>
    <plan-editor class="editor" if="${a}.editing" label="Add comment" placeholder="What is wrong with it?" text="{{${a}.editorText}}"></plan-editor>
    ${edges}
  </li>`

const SPEC_MARKUP = `
  <p class="note" if="approved">This plan is approved. Its review is kept as the record of how it was reached; reopen or supersede the plan to comment again.</p>
  <p class="note" if="stale">{{staleText}}</p>
  <div class="item whole" data-item="{{whole.name}}">
    <div class="line">
      <span class="text">The plan as a whole</span>
      <button type="button" if="whole.controls" r-click="comment(whole.name)">Comment</button>
    </div>
    <ul class="comments" if="whole.hasComments">${commentMarkup('whole.comments')}</ul>
    <plan-editor class="editor" if="whole.editing" label="Add comment" placeholder="What is wrong with it?" text="{{whole.editorText}}"></plan-editor>
  </div>
  <section class="goal">
    <h2 class="heading">Goal</h2>
    <markdown-text class="prose" block text="{{goal}}"></markdown-text>
  </section>
  <section loop="s in scenarios" class="scenario">
    <h2 class="heading">{{s.title}}</h2>
    <markdown-text class="prose intro" block if="s.hasIntro" text="{{s.intro}}"></markdown-text>
    <ul class="rules">${itemMarkup('i', 's.rules', `<ul class="edges" if="i.hasEdges">${itemMarkup('e', 'i.edges', '')}</ul>`)}</ul>
  </section>
  <section class="questions" if="hasQuestions">
    <h2 class="heading">Open questions</h2>
    <ul class="rules">${itemMarkup('q', 'questions', '')}</ul>
  </section>`

/**
 * The spec as the contract reads it: the goal, the scenarios with their rules
 * and the edge cases that qualify them, and the open questions, with the
 * review written on the rows it is about. This is where a comment is started
 * and a rule struck.
 */
export class PlanSpecTab extends PlanTab {
  private readonly template = compileTemplate(SPEC_MARKUP)

  protected draw(plan: PlanState): void {
    const spec = plan.spec
    if (!spec) return
    if (this.childElementCount === 0) this.appendChild(this.template.content)
    this.template.render(this.context(plan, spec), {
      ...this.commentFns(),
      open: (path: string) => post({ type: 'open_file', path }),
      comment: (name: string) => this.openEditor({ kind: 'comment', target: name, text: '' }),
      strike: (name: string) => this.act({ type: 'strike_item', item: name }),
      unstrike: (name: string) => this.act({ type: 'unstrike_item', item: name }),
    })
  }

  private context(plan: PlanState, spec: Spec) {
    const editor = this.editor
    return {
      approved: !plan.commentable && plan.review.rounds.length > 0,
      stale: plan.stale,
      staleText: staleNote(pendingDecisions(plan).map((d) => d.title)),
      whole: { name: PLAN_TARGET, controls: plan.commentable, ...attached(plan, PLAN_TARGET, editor) },
      goal: spec.goal,
      scenarios: spec.scenarios.map((s) => ({ title: s.title, hasIntro: s.intro !== '', intro: s.intro, rules: s.behaviours.map((b) => this.ruleRow(b, plan)) })),
      hasQuestions: spec.questions.length > 0,
      questions: spec.questions.map((q) => itemRow(q, plan, 'question', editor)),
    }
  }

  private ruleRow(behaviour: Item & { edges: Item[] }, plan: PlanState): RuleRow {
    return {
      ...itemRow(behaviour, plan, 'behaviour', this.editor),
      hasEdges: behaviour.edges.length > 0,
      edges: behaviour.edges.map((edge) => itemRow(edge, plan, 'edge', this.editor)),
    }
  }
}

function itemRow(item: Item, plan: PlanState, kind: 'behaviour' | 'edge' | 'question', editor: Editor | undefined): ItemRow {
  const struck = struckItems(plan.review).some((s) => same(s, item.name))
  const pending = pendingRound(plan.review)?.strikes.some((s) => same(s, item.name)) ?? false
  const text = item.text.replace(MARKER, '').trim()
  return {
    name: item.name,
    className: `item ${kind}${struck || item.removed ? ' struck' : ''}`,
    rest: text ? `: ${text}` : '',
    cited: item.citation !== undefined,
    citation: item.citation ?? '',
    citationPath: item.citation?.split('#')[0] ?? '',
    removed: item.removed,
    struckBadge: !item.removed && struck,
    ...coverage(item.name, plan, kind === 'question'),
    controls: plan.commentable,
    strikeable: plan.commentable && !struck,
    unstrikeable: plan.commentable && struck && pending,
    ...attached(plan, item.name, editor),
  }
}

const NO_COVERAGE: Coverage = { hasTask: false, taskName: '', taskTitle: '', noTask: false, hasProof: false, proofFile: '', proofTitle: '', noProof: false }

/** Nothing to say before there is a board, and a question is not built or proven. */
function coverage(name: string, plan: PlanState, question: boolean): Coverage {
  if (question || plan.tasks.length === 0) return NO_COVERAGE
  const live = plan.tasks.filter((t) => !t.removed)
  const task = live.find((t) => t.delivers.some((d) => same(d, name)))
  const built = plan.stage === 'under_development' || plan.stage === 'verification' || plan.stage === 'verified'
  const proof = built ? live.flatMap((t) => t.proves).find((p) => same(p.item, name)) : undefined
  return {
    hasTask: task !== undefined,
    taskName: task?.name ?? '',
    taskTitle: task ? `Delivered by ${task.name}: ${task.text}` : '',
    noTask: task === undefined,
    hasProof: proof !== undefined,
    proofFile: proof?.file ?? '',
    proofTitle: proof ? `Proven by ${proof.test} in ${proof.file}` : '',
    noProof: built && proof === undefined,
  }
}

function attached(plan: PlanState, target: string, editor: Editor | undefined): Attached {
  const placed = commentsOn(plan.review, target)
  return {
    comments: commentRows(placed, plan, false, editor),
    hasComments: placed.length > 0,
    editing: editor?.kind === 'comment' && editor.comment === undefined && same(editor.target, target),
    editorText: editor?.text ?? '',
  }
}

customElements.define('plan-spec-tab', PlanSpecTab)

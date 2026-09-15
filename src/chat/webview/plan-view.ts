import type { PlanState } from '../protocol'
import type { Decision } from '../../agent/phases/decisions'
import type { CommentRef, Review, ReviewComment, ReviewRound } from '../../agent/phases/plan-review'
import type { Item, Scenario, Spec } from '../../agent/phases/spec-model'
import type { Task, TaskState } from '../../agent/phases/tasks-file'
import { ReviewActionEvent } from './events'
import { renderMarkdown } from './markdown'
import { post } from './vscode-api'

const PLAN_TARGET = 'plan'
const MARKER = /\s*\[(?:in progress|done|tested|removed|applied|withdrawn|blocked[^\]]*)\]/gi

const TASK_STATE: Record<TaskState, string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
  tested: 'tested',
  blocked: 'blocked',
}

const DECISION_STATE: Record<Decision['state'], string> = {
  open: 'to rule on',
  ruled: 'ruled',
  applied: 'applied',
  withdrawn: 'withdrawn',
}

/** A comment box on a rule or the plan, an edit of a pending comment, or a ruling being written on a decision. */
type Editor = { kind: 'comment'; target: string; comment?: CommentRef; text: string } | { kind: 'ruling'; target: string; text: string }

/** A comment with its place in the review, which is how the host addresses it. */
type PlacedComment = { ref: CommentRef; comment: ReviewComment; pending: boolean }

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The plan, built from the spec as the contract reads it: the goal, one card
 * per scenario with its rules and their edge cases, the open questions, the
 * decisions, and the task board grouped as the board groups it. What the
 * stage adds rides on the rows: the review controls on a draft, the task that
 * delivers a rule once mapped, the test that proves it once work has started.
 * Built by hand rather than from a template so an open comment box keeps its
 * text and caret while the plan around it is re-rendered.
 */
export class PlanView extends HTMLElement {
  private plan: PlanState | undefined
  private editor: Editor | undefined
  private signature = ''

  update(plan: PlanState | undefined): void {
    const signature = JSON.stringify(
      plan
        ? {
            body: plan.body,
            stage: plan.stage,
            status: plan.status,
            review: plan.review,
            commentable: plan.commentable,
            tasks: plan.tasks,
            stale: plan.stale,
            lastVerification: plan.lastVerification,
          }
        : null,
    )
    const changed = signature !== this.signature
    this.signature = signature
    this.plan = plan
    if (changed) this.draw()
  }

  private act(action: ConstructorParameters<typeof ReviewActionEvent>[0]): void {
    this.dispatchEvent(new ReviewActionEvent(action))
  }

  private openEditor(editor: Editor | undefined): void {
    this.editor = editor
    this.draw()
  }

  private draw(): void {
    this.replaceChildren()
    const plan = this.plan
    if (!plan?.body || !plan.spec) return
    const spec = plan.spec
    this.append(el('h1', 'title', spec.title || plan.specPath))
    if (spec.problems.length > 0) {
      // Off contract: the file as written, so nothing the model put there is hidden, and no review on it until it is repaired.
      this.append(this.problemsBox(spec.problems))
      const raw = el('div', 'body')
      renderMarkdown(plan.body, raw, true)
      this.append(raw)
      return
    }
    if (!plan.commentable && plan.review.rounds.length > 0) {
      this.append(
        note('This plan is approved. Its review is kept as the record of how it was reached; reopen or supersede the plan to comment again.'),
      )
    }
    if (plan.stale) this.append(note(staleNote(spec.decisions.filter((d) => d.state === 'open' || d.state === 'ruled').map((d) => d.title))))
    const round = pendingRound(plan.review)
    if (round) this.append(this.pendingSection(plan, round))
    this.append(this.wholePlanRow(plan), this.goalSection(spec))
    for (const scenario of spec.scenarios) this.append(this.scenarioCard(scenario, plan))
    if (spec.questions.length > 0) this.append(this.questionsSection(spec, plan))
    if (spec.decisions.length > 0) this.append(this.decisionsSection(spec, plan))
    if (plan.tasks.length > 0) this.append(this.tasksSection(plan))
  }

  private problemsBox(problems: string[]): HTMLElement {
    const box = el('section', 'problems')
    box.append(el('h3', 'heading', 'Off contract'))
    const list = el('ul', 'list')
    for (const problem of problems) list.append(el('li', 'problem', problem))
    box.append(list, note('Repair from the plan bar: the planner rearranges the spec, the rules stay the rules.'))
    return box
  }

  // --- the pending batch ------------------------------------------------------

  private pendingSection(plan: PlanState, round: ReviewRound): HTMLElement {
    const section = el('section', 'pending')
    section.append(el('h3', 'heading', `Pending review, round ${round.number}`))
    const list = el('ul', 'comments')
    round.comments.forEach((comment, index) => list.append(this.commentRow({ ref: { round: round.number, index }, comment, pending: true }, plan)))
    if (round.strikes.length > 0) {
      const struck = el('li', 'strikes')
      struck.append(el('span', 'label', `remove: ${round.strikes.join(', ')}`))
      section.append(list, struck)
    } else section.append(list)
    const submit = button('Submit review', () => this.act({ type: 'submit_review' }))
    submit.className = 'submit'
    submit.title = 'Hand the plan and this review to the session that owns it.'
    submit.disabled = !plan.commentable
    section.append(submit)
    return section
  }

  // --- the spec, section by section -------------------------------------------

  private wholePlanRow(plan: PlanState): HTMLElement {
    const row = el('div', 'item whole')
    const line = el('div', 'line')
    line.append(el('span', 'text', 'The plan as a whole'))
    if (plan.commentable) line.append(button('Comment', () => this.openEditor({ kind: 'comment', target: PLAN_TARGET, text: '' })))
    row.append(line, ...this.attachments(plan, PLAN_TARGET))
    return row
  }

  private goalSection(spec: Spec): HTMLElement {
    const section = el('section', 'goal')
    section.append(el('h2', 'heading', 'Goal'))
    const prose = el('div', 'prose')
    renderMarkdown(spec.goal, prose, true)
    section.append(prose)
    return section
  }

  /** One scenario: its rules, each with the edge cases that qualify it indented beneath. */
  private scenarioCard(scenario: Scenario, plan: PlanState): HTMLElement {
    const card = el('section', 'scenario')
    card.append(el('h2', 'heading', scenario.title))
    if (scenario.intro) {
      const intro = el('div', 'prose intro')
      renderMarkdown(scenario.intro, intro, true)
      card.append(intro)
    }
    const rules = el('ul', 'rules')
    for (const behaviour of scenario.behaviours) {
      const row = this.itemRow(behaviour, plan, 'behaviour')
      if (behaviour.edges.length > 0) {
        const edges = el('ul', 'edges')
        for (const edge of behaviour.edges) edges.append(this.itemRow(edge, plan, 'edge'))
        row.append(edges)
      }
      rules.append(row)
    }
    card.append(rules)
    return card
  }

  private questionsSection(spec: Spec, plan: PlanState): HTMLElement {
    const section = el('section', 'questions')
    section.append(el('h2', 'heading', 'Open questions'))
    const list = el('ul', 'rules')
    for (const question of spec.questions) list.append(this.itemRow(question, plan, 'question'))
    section.append(list)
    return section
  }

  private decisionsSection(spec: Spec, plan: PlanState): HTMLElement {
    const section = el('section', 'decisions')
    section.append(el('h2', 'heading', 'Decisions'))
    const list = el('ul', 'rules')
    for (const decision of spec.decisions) list.append(this.decisionRow(decision, plan))
    section.append(list)
    return section
  }

  /**
   * A rule, edge case or question: its name as the lead-in, its text, and to
   * the right what the reader needs at a glance: a gap in coverage, a strike,
   * the intent link; what is in order stays quiet, and the review controls
   * show on hover.
   */
  private itemRow(item: Item, plan: PlanState, kind: 'behaviour' | 'edge' | 'question'): HTMLElement {
    const struck = struckItems(plan.review).some((s) => same(s, item.name))
    const row = el('li', `item ${kind}${struck || item.removed ? ' struck' : ''}`)
    const line = el('div', 'line')
    const aside = el('span', 'aside')
    if (item.citation) {
      const link = fileLink(item.citation.split('#')[0]!, 'intent')
      link.classList.add('citation')
      link.title = item.citation
      aside.append(link)
    }
    if (item.removed) aside.append(el('span', 'badge removed', 'removed'))
    else if (struck) aside.append(el('span', 'badge struck', 'struck'))
    if (kind !== 'question') aside.append(...this.coverage(item.name, plan))
    aside.append(...this.controls(item.name, plan, true))
    line.append(named(item.name, item.text.replace(MARKER, '').trim()), aside)
    row.append(line, ...this.attachments(plan, item.name))
    return row
  }

  /** A decision: what the code and the spec disagree on, what is proposed, and the ruling, with the buttons that make one. */
  private decisionRow(decision: Decision, plan: PlanState): HTMLElement {
    const row = el('li', `item decision ${decision.state}`)
    const line = el('div', 'line')
    const aside = el('span', 'aside')
    for (const name of decision.on) {
      const chip = el('span', 'chip rule', name)
      chip.title = `Concerns the rule "${name}"`
      aside.append(chip)
    }
    aside.append(el('span', `badge state ${decision.state}`, DECISION_STATE[decision.state]))
    line.append(el('span', 'text', decision.title), aside)
    row.append(line, labelled('finding', 'finding', decision.finding))
    if (decision.proposal) row.append(labelled('proposal', 'proposed', decision.proposal))
    else if (decision.state === 'open') row.append(el('div', 'awaiting', 'waiting for the planner to propose'))
    if (decision.ruling) row.append(labelled('ruling', 'ruling', decision.ruling))
    const rulable = plan.commentable && (decision.state === 'open' || decision.state === 'ruled')
    if (rulable && this.editor?.kind === 'ruling' && same(this.editor.target, decision.title)) row.append(this.editorBox(this.editor))
    else if (rulable) row.append(this.rulingControls(decision))
    return row
  }

  private rulingControls(decision: Decision): HTMLElement {
    const wrap = el('div', 'rulings')
    if (decision.state === 'open' && decision.proposal) {
      wrap.append(
        button('Accept proposal', () => this.act({ type: 'rule_decision', decision: decision.title, ruling: 'accepted' }), {
          title: 'Rule as proposed. Approve hands the rulings to the planner; nothing is sent now.',
        }),
      )
    }
    const own = decision.state === 'ruled' ? 'Change ruling' : decision.proposal ? 'Rule otherwise' : 'Rule'
    wrap.append(
      button(own, () => this.openEditor({ kind: 'ruling', target: decision.title, text: decision.ruling === 'accepted' ? '' : (decision.ruling ?? '') }), {
        title: 'Write your own ruling. Approve hands the rulings to the planner; nothing is sent now.',
      }),
    )
    return wrap
  }

  /** What builds the rule and what proves it, once there is a board to say so: a gap is a badge, what is in order a quiet mark. */
  private coverage(name: string, plan: PlanState): HTMLElement[] {
    if (plan.tasks.length === 0) return []
    const marks: HTMLElement[] = []
    const live = plan.tasks.filter((t) => !t.removed)
    const task = live.find((t) => t.delivers.some((d) => same(d, name)))
    if (task) {
      const chip = el('span', 'chip task', task.name)
      chip.title = `Delivered by ${task.name}: ${task.text.replace(MARKER, '').trim()}`
      marks.push(chip)
    } else marks.push(el('span', 'badge gap', 'no task'))
    if (plan.stage === 'under_development' || plan.stage === 'verification' || plan.stage === 'verified') {
      const proof = live.flatMap((t) => t.proves).find((p) => same(p.item, name))
      if (proof) {
        const link = fileLink(proof.file, '✓')
        link.classList.add('chip', 'proof')
        link.title = `Proven by ${proof.test} in ${proof.file}`
        marks.push(link)
      } else marks.push(el('span', 'badge gap', 'no test'))
    }
    return marks
  }

  private controls(name: string, plan: PlanState, strikeable: boolean): HTMLElement[] {
    if (!plan.commentable) return []
    const controls: HTMLElement[] = [button('Comment', () => this.openEditor({ kind: 'comment', target: name, text: '' }))]
    if (strikeable) {
      const struck = struckItems(plan.review).some((s) => same(s, name))
      const pending = pendingRound(plan.review)?.strikes.some((s) => same(s, name)) ?? false
      if (!struck) controls.push(button('Strike', () => this.act({ type: 'strike_item', item: name })))
      else if (pending) controls.push(button('Unstrike', () => this.act({ type: 'unstrike_item', item: name })))
    }
    const wrap = el('span', 'controls')
    wrap.append(...controls)
    return [wrap]
  }

  // --- the task board ---------------------------------------------------------

  /** Tasks as the board groups them: under the heading the mapping put them, in file order. */
  private tasksSection(plan: PlanState): HTMLElement {
    const section = el('section', 'tasks')
    const heading = el('h2', 'heading', 'Tasks')
    heading.title = plan.tasksPath
    section.append(heading)
    const groups: { title: string; tasks: Task[] }[] = []
    for (const task of plan.tasks) {
      const title = task.group ?? ''
      const last = groups.at(-1)
      if (last && last.title === title) last.tasks.push(task)
      else groups.push({ title, tasks: [task] })
    }
    for (const group of groups) section.append(this.taskGroup(group.title, group.tasks, plan))
    const record = plan.lastVerification
    if (record) {
      const line = el('p', `verification ${record.ok ? 'ok' : 'failed'}`)
      line.append(el('span', 'kind', record.ok ? 'tests passed' : 'tests failed'), el('span', 'text', `${record.text} (${record.at})`))
      section.append(line)
    }
    return section
  }

  private taskGroup(title: string, tasks: Task[], plan: PlanState): HTMLElement {
    const group = el('div', 'group')
    if (title) group.append(el('h3', 'heading', title))
    const list = el('ul', 'board')
    for (const task of tasks) list.append(this.taskRow(task, plan))
    group.append(list)
    return group
  }

  private taskRow(task: Task, plan: PlanState): HTMLElement {
    const started = plan.stage !== 'mapped'
    const row = el('li', `task ${task.state}${task.removed ? ' removed' : ''}`)
    const line = el('div', 'line')
    line.append(named(task.name, task.text.replace(MARKER, '').trim()))
    if (task.delivers.length > 0) line.append(el('span', 'delivers', task.delivers.join(', ')))
    if (task.removed) line.append(el('span', 'badge removed', 'removed'))
    else if (started) {
      line.append(el('span', `badge state ${task.state}`, blockedReason(task) ?? TASK_STATE[task.state]))
      const unproven = task.state === 'tested' ? task.delivers.filter((d) => !task.proves.some((p) => same(p.item, d))) : []
      if (unproven.length > 0) line.append(el('span', 'badge gap', `no test for ${unproven.join(', ')}`))
    }
    row.append(line)
    if (task.files.length > 0) {
      const files = el('div', 'files')
      for (const file of task.files) files.append(fileLink(file, file))
      row.append(files)
    }
    if (task.context.length > 0) {
      const context = el('div', 'files context')
      context.title = 'What the mapping read to arrive at this task; the implementer starts here.'
      context.append(el('span', 'label', 'context'))
      for (const file of task.context) context.append(fileLink(file, file))
      row.append(context)
    }
    return row
  }

  // --- comments ---------------------------------------------------------------

  /** The comments on a target and, when one is being written for it, the editor. */
  private attachments(plan: PlanState, target: string): HTMLElement[] {
    const nodes: HTMLElement[] = []
    const comments = commentsOn(plan.review, target)
    if (comments.length > 0) {
      const list = el('ul', 'comments')
      for (const placed of comments) list.append(this.commentRow(placed, plan))
      nodes.push(list)
    }
    const editor = this.editor
    if (editor?.kind === 'comment' && same(editor.target, target) && !editor.comment) nodes.push(this.editorBox(editor))
    return nodes
  }

  private commentRow({ ref, comment, pending }: PlacedComment, plan: PlanState): HTMLElement {
    const row = el('li', `comment${comment.closed ? ' closed' : ' open'}`)
    const editor = this.editor
    if (editor?.kind === 'comment' && editor.comment && sameRef(editor.comment, ref)) {
      row.append(this.editorBox(editor))
      return row
    }
    const head = el('div', 'line')
    head.append(el('span', 'text', comment.text))
    if (pending && plan.commentable) {
      head.append(
        button('Edit', () => this.openEditor({ kind: 'comment', target: comment.target, comment: ref, text: comment.text })),
        button('Remove', () => this.act({ type: 'remove_comment', comment: ref })),
      )
    }
    row.append(head)
    if (comment.resolution) {
      const resolution = el('div', `resolution ${comment.resolution.kind}`)
      resolution.append(el('span', 'kind', comment.resolution.kind), el('span', 'text', comment.resolution.text))
      if (!comment.closed) {
        resolution.append(
          button('Resolve', () => this.act({ type: 'resolve_comment', comment: ref }), {
            title:
              comment.resolution.kind === 'disagreed'
                ? 'Close this comment although the agent disagreed with it.'
                : 'Close this comment.',
          }),
        )
      }
      row.append(resolution)
    } else if (!pending) row.append(el('div', 'awaiting', 'waiting for the agent to resolve this'))
    return row
  }

  private editorBox(editor: Editor): HTMLElement {
    const box = el('div', 'editor')
    const area = document.createElement('textarea')
    area.value = editor.text
    area.rows = 3
    area.placeholder = editor.kind === 'ruling' ? 'What should happen instead?' : 'What is wrong with it?'
    area.addEventListener('input', () => (editor.text = area.value))
    const label = editor.kind === 'ruling' ? 'Rule' : editor.comment ? 'Save' : 'Add comment'
    const save = button(label, () => {
      const text = area.value.trim()
      if (!text) return
      this.editor = undefined
      if (editor.kind === 'ruling') this.act({ type: 'rule_decision', decision: editor.target, ruling: text })
      else if (editor.comment) this.act({ type: 'edit_comment', comment: editor.comment, text })
      else this.act({ type: 'add_comment', target: editor.target, text })
      this.draw()
    })
    box.append(area, save, button('Cancel', () => this.openEditor(undefined)))
    queueMicrotask(() => area.focus())
    return box
  }
}

function pendingRound(review: Review) {
  const last = review.rounds.at(-1)
  return last && last.submittedAt === undefined ? last : undefined
}

function struckItems(review: Review): string[] {
  return review.rounds.flatMap((r) => r.strikes)
}

/** Every comment on a target with where it sits, since the file gives a comment no id of its own. */
function commentsOn(review: Review, target: string): PlacedComment[] {
  const placed: PlacedComment[] = []
  for (const round of review.rounds) {
    round.comments.forEach((comment, index) => {
      if (same(comment.target, target)) placed.push({ ref: { round: round.number, index }, comment, pending: round.submittedAt === undefined })
    })
  }
  return placed
}

const sameRef = (a: CommentRef, b: CommentRef): boolean => a.round === b.round && a.index === b.index

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** `Name: text`, the name as the lead-in it is in the file. */
function named(name: string, text: string): HTMLElement {
  const span = el('span', 'text')
  span.append(el('strong', 'name', name), text ? `: ${text}` : '')
  return span
}

/** A labelled line of a decision: what the mapper found, what the planner proposed, what the user ruled. */
function labelled(className: string, kind: string, text: string): HTMLElement {
  const line = el('div', className)
  line.append(el('span', 'kind', kind), el('span', 'text', text))
  return line
}

function note(text: string): HTMLElement {
  return el('p', 'note', text)
}

/** The re-map waits for the rulings to be applied: a board mapped under a pending decision would go stale on the revision. */
function staleNote(pendingDecisions: string[]): string {
  if (pendingDecisions.length === 0) return 'The tasks predate the last change to the spec; they are re-mapped when the plan session’s turn ends.'
  return `The tasks predate the last change to the spec; they are re-mapped once ${pendingDecisions.map((t) => `"${t}"`).join(', ')} ${pendingDecisions.length === 1 ? 'is' : 'are'} ruled on and applied.`
}

/** `[blocked: reason]` as written; the reason is what the badge should say. */
function blockedReason(task: Task): string | undefined {
  const match = /\[blocked\s*:?\s*([^\]]*)\]/i.exec(task.text)
  if (!match) return undefined
  const reason = match[1]!.trim()
  return reason ? `blocked: ${reason}` : 'blocked'
}

function fileLink(path: string, label: string): HTMLButtonElement {
  const link = button(label, () => post({ type: 'open_file', path }))
  link.className = 'link file'
  link.title = `Open ${path}`
  return link
}

function button(label: string, onClick: () => void, options: { title?: string } = {}): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (options.title) node.title = options.title
  node.addEventListener('click', onClick)
  return node
}

customElements.define('plan-view', PlanView)

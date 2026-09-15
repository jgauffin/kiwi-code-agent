import type { PlanState } from '../protocol'
import type { Review, ReviewComment, ReviewRound } from '../../agent/phases/plan-review'
import type { Finding } from '../../agent/phases/reconcile'
import type { Item, Scenario, Spec } from '../../agent/phases/spec-model'
import type { Task, TaskState } from '../../agent/phases/tasks-file'
import { ReviewActionEvent } from './events'
import { renderMarkdown } from './markdown'
import { post } from './vscode-api'

const PLAN_TARGET = 'plan'
const MARKER = /\s*\[(?:in progress|done|tested|removed|resolved|blocked[^\]]*)\]/gi

const TASK_STATE: Record<TaskState, string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
  tested: 'tested',
  blocked: 'blocked',
}

type Editor = { target: string; commentId?: string; text: string }

/**
 * The plan, built from the spec as the contract reads it: the goal, one card
 * per scenario with its rules and their edge cases, the open questions, the
 * findings, and the task board grouped under the scenarios it delivers. What
 * the stage adds rides on the rows: the review controls on a draft, the task
 * that delivers an item once mapped, the test that proves it once work has
 * started. Built by hand rather than from a template so an open comment box
 * keeps its text and caret while the plan around it is re-rendered.
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
    if (plan.stale) this.append(note(staleNote(spec.findings.filter((f) => !f.resolved).map((f) => f.id))))
    const round = pendingRound(plan.review)
    if (round) this.append(this.pendingSection(plan, round))
    this.append(this.wholePlanRow(plan), this.goalSection(spec))
    for (const scenario of spec.scenarios) this.append(this.scenarioCard(scenario, plan))
    if (spec.questions.length > 0) this.append(this.questionsSection(spec, plan))
    if (spec.findings.length > 0) this.append(this.findingsSection(spec, plan))
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
    section.append(el('h3', 'heading', `Pending review — round ${round.number}`))
    const list = el('ul', 'comments')
    for (const comment of round.comments) list.append(this.commentRow(comment, plan, true))
    if (round.strikes.length > 0) {
      const struck = el('li', 'strikes')
      struck.append(el('span', 'label', `struck: ${round.strikes.join(', ')}`))
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
    if (plan.commentable) line.append(button('Comment', () => this.openEditor({ target: PLAN_TARGET, text: '' })))
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

  private findingsSection(spec: Spec, plan: PlanState): HTMLElement {
    const section = el('section', 'findings')
    section.append(el('h2', 'heading', 'Findings'))
    const list = el('ul', 'rules')
    for (const finding of spec.findings) list.append(this.findingRow(finding, plan))
    section.append(list)
    return section
  }

  /**
   * A behaviour, edge case or question: id, text, and to the right what the
   * reader needs at a glance: a gap in coverage, a strike, the intent link;
   * what is in order stays quiet, and the review controls show on hover.
   */
  private itemRow(item: Item, plan: PlanState, kind: 'behaviour' | 'edge' | 'question'): HTMLElement {
    const struck = struckItems(plan.review).includes(item.id)
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
    if (kind !== 'question') aside.append(...this.coverage(item.id, plan))
    aside.append(...this.controls(item.id, plan, true))
    line.append(el('span', 'id', item.id), el('span', 'text', item.text.replace(MARKER, '').trim()), aside)
    row.append(line, ...this.attachments(plan, item.id))
    return row
  }

  private findingRow(finding: Finding, plan: PlanState): HTMLElement {
    const struck = struckItems(plan.review).includes(finding.id)
    const row = el('li', `item finding${finding.resolved ? ' resolved' : ''}${struck ? ' struck' : ''}`)
    const line = el('div', 'line')
    const aside = el('span', 'aside')
    aside.append(el('span', `badge state ${finding.resolved ? 'resolved' : 'open'}`, finding.resolved ? 'resolved' : 'to rule on'))
    if (struck) aside.append(el('span', 'badge struck', 'struck'))
    aside.append(...this.controls(finding.id, plan, false))
    line.append(el('span', 'id', finding.id), el('span', 'text', finding.text.replace(MARKER, '').trim()), aside)
    row.append(line)
    if (finding.proposal) {
      const proposal = el('div', 'proposal')
      proposal.append(el('span', 'kind', 'proposed'), el('span', 'text', finding.proposal))
      row.append(proposal)
    }
    row.append(...this.attachments(plan, finding.id))
    return row
  }

  /** What builds the item and what proves it, once there is a board to say so: a gap is a badge, what is in order a quiet mark. */
  private coverage(id: string, plan: PlanState): HTMLElement[] {
    if (plan.tasks.length === 0) return []
    const marks: HTMLElement[] = []
    const live = plan.tasks.filter((t) => !t.removed)
    const task = live.find((t) => t.delivers.includes(id))
    if (task) {
      const chip = el('span', 'chip task', task.id)
      chip.title = `Delivered by ${task.id}: ${task.text.replace(MARKER, '').trim()}`
      marks.push(chip)
    } else marks.push(el('span', 'badge gap', 'no task'))
    if (plan.stage === 'under_development' || plan.stage === 'verification' || plan.stage === 'verified') {
      const proof = live.flatMap((t) => t.proves).find((p) => p.item === id)
      if (proof) {
        const link = fileLink(proof.file, '✓')
        link.classList.add('chip', 'proof')
        link.title = `Proven by ${proof.test} in ${proof.file}`
        marks.push(link)
      } else marks.push(el('span', 'badge gap', 'no test'))
    }
    return marks
  }

  private controls(id: string, plan: PlanState, strikeable: boolean): HTMLElement[] {
    if (!plan.commentable) return []
    const controls: HTMLElement[] = [button('Comment', () => this.openEditor({ target: id, text: '' }))]
    if (strikeable) {
      const struck = struckItems(plan.review).includes(id)
      const pending = pendingRound(plan.review)?.strikes.includes(id) ?? false
      if (!struck) controls.push(button('Strike', () => this.act({ type: 'strike_item', itemId: id })))
      else if (pending) controls.push(button('Unstrike', () => this.act({ type: 'unstrike_item', itemId: id })))
    }
    const wrap = el('span', 'controls')
    wrap.append(...controls)
    return [wrap]
  }

  // --- the task board ---------------------------------------------------------

  /** Tasks under the scenarios they deliver; a foundation task appears under each it serves. */
  private tasksSection(plan: PlanState): HTMLElement {
    const section = el('section', 'tasks')
    const heading = el('h2', 'heading', 'Tasks')
    heading.title = plan.tasksPath
    section.append(heading)
    const spec = plan.spec!
    const placed = new Set<string>()
    for (const scenario of spec.scenarios) {
      const ids = new Set(scenario.behaviours.flatMap((b) => [b.id, ...b.edges.map((e) => e.id)]))
      const tasks = plan.tasks.filter((t) => t.delivers.some((d) => ids.has(d)))
      if (tasks.length === 0) continue
      for (const task of tasks) placed.add(task.id)
      section.append(this.taskGroup(scenario.title, tasks, plan))
    }
    const rest = plan.tasks.filter((t) => !placed.has(t.id))
    if (rest.length > 0) section.append(this.taskGroup(placed.size > 0 ? 'Other' : '', rest, plan))
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
    line.append(el('span', 'id', task.id), el('span', 'text', task.text.replace(MARKER, '').trim()))
    if (task.delivers.length > 0) line.append(el('span', 'delivers', task.delivers.join(', ')))
    if (task.removed) line.append(el('span', 'badge removed', 'removed'))
    else if (started) {
      line.append(el('span', `badge state ${task.state}`, blockedReason(task) ?? TASK_STATE[task.state]))
      const unproven = task.state === 'tested' ? task.delivers.filter((d) => !task.proves.some((p) => p.item === d)) : []
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
    const comments = commentsFor(plan.review, target)
    if (comments.length > 0) {
      const list = el('ul', 'comments')
      for (const comment of comments) list.append(this.commentRow(comment, plan, isPending(plan.review, comment.id)))
      nodes.push(list)
    }
    if (this.editor && this.editor.target === target && !this.editor.commentId) nodes.push(this.editorBox(this.editor))
    return nodes
  }

  private commentRow(comment: ReviewComment, plan: PlanState, pending: boolean): HTMLElement {
    const row = el('li', `comment${comment.closed ? ' closed' : ' open'}`)
    if (this.editor?.commentId === comment.id) {
      row.append(this.editorBox(this.editor))
      return row
    }
    const head = el('div', 'line')
    head.append(el('span', 'id', comment.id), el('span', 'text', comment.text))
    if (pending && plan.commentable) {
      head.append(
        button('Edit', () => this.openEditor({ target: comment.target, commentId: comment.id, text: comment.text })),
        button('Remove', () => this.act({ type: 'remove_comment', commentId: comment.id })),
      )
    }
    row.append(head)
    if (comment.resolution) {
      const resolution = el('div', `resolution ${comment.resolution.kind}`)
      resolution.append(el('span', 'kind', comment.resolution.kind), el('span', 'text', comment.resolution.text))
      if (!comment.closed) {
        resolution.append(
          button('Accept', () => this.act({ type: 'accept_resolution', commentId: comment.id }), {
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
    area.placeholder = 'What is wrong with it?'
    area.addEventListener('input', () => (editor.text = area.value))
    const save = button(editor.commentId ? 'Save' : 'Add comment', () => {
      const text = area.value.trim()
      if (!text) return
      this.editor = undefined
      if (editor.commentId) this.act({ type: 'edit_comment', commentId: editor.commentId, text })
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

function isPending(review: Review, commentId: string): boolean {
  return pendingRound(review)?.comments.some((c) => c.id === commentId) ?? false
}

function struckItems(review: Review): string[] {
  return review.rounds.flatMap((r) => r.strikes)
}

function commentsFor(review: Review, target: string): ReviewComment[] {
  return review.rounds.flatMap((r) => r.comments).filter((c) => c.target === target)
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function note(text: string): HTMLElement {
  return el('p', 'note', text)
}

/** The re-map waits for the rulings: a board mapped under an open finding would go stale on the next one. */
function staleNote(openFindings: string[]): string {
  if (openFindings.length === 0) return 'The tasks predate the last change to the spec; they are re-mapped when the plan session’s turn ends.'
  return `The tasks predate the last change to the spec; they are re-mapped once ${openFindings.join(', ')} ${openFindings.length === 1 ? 'is' : 'are'} ruled on.`
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

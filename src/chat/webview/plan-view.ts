import type { PlanState } from '../protocol'
import type { PlanItem, Review, ReviewComment, ReviewRound } from '../../agent/phases/plan-review'
import type { Task, TaskState } from '../../agent/phases/tasks-file'
import { ReviewActionEvent } from './events'
import { renderMarkdown } from './markdown'
import { post } from './vscode-api'

const PLAN_TARGET = 'plan'
const ITEM_ID = /^\s*([A-Z]{1,3}\d+)\b/
const MARKER = /\s*\[(?:in progress|done|tested|removed|blocked[^\]]*)\]/gi

const TASK_STATE: Record<TaskState, string> = {
  open: 'open',
  in_progress: 'in progress',
  done: 'done',
  tested: 'tested',
  blocked: 'blocked',
}

type Editor = { target: string; commentId?: string; text: string }

/**
 * The spec, rendered where the transcript normally is, with what the stage
 * adds: the review on a draft (each item line carries its comments, its
 * strike, and the controls to add more; the pending batch sits on top), the
 * task board once the spec is mapped, each task's state once work has
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
            items: plan.items,
            review: plan.review,
            commentable: plan.commentable,
            tasks: plan.tasks,
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
    if (!plan?.body) return
    if (!plan.commentable && plan.review.rounds.length > 0) {
      this.append(
        note('This plan is approved. Its review is kept as the record of how it was reached; reopen or supersede the plan to comment again.'),
      )
    }
    // The batch is shown while it is being written; once sent it lives on the items, and the spec reads unobstructed.
    const round = pendingRound(plan.review)
    if (round) this.append(this.pendingSection(plan, round))
    const body = el('div', 'body')
    renderMarkdown(plan.body, body, true)
    this.decorate(body, plan)
    this.append(body)
    if (plan.tasks.length > 0) this.append(this.tasksSection(plan))
  }

  // --- the task board ---------------------------------------------------------

  /** Tasks with the items they deliver and the files they touch; a state badge once work has started. */
  private tasksSection(plan: PlanState): HTMLElement {
    const section = el('section', 'tasks')
    const heading = el('h2', 'heading', 'Tasks')
    heading.title = plan.tasksPath
    section.append(heading)
    const list = el('ul', 'board')
    for (const task of plan.tasks) list.append(this.taskRow(task, plan))
    section.append(list)
    const record = plan.lastVerification
    if (record) {
      const line = el('p', `verification ${record.ok ? 'ok' : 'failed'}`)
      line.append(el('span', 'kind', record.ok ? 'tests passed' : 'tests failed'), el('span', 'text', `${record.text} (${record.at})`))
      section.append(line)
    }
    return section
  }

  private taskRow(task: Task, plan: PlanState): HTMLElement {
    const started = plan.stage !== 'mapped'
    const row = el('li', `task ${task.state}${task.removed ? ' removed' : ''}`)
    const line = el('div', 'line')
    line.append(el('span', 'id', task.id), el('span', 'text', task.text.replace(MARKER, '').trim()))
    if (task.delivers.length > 0) line.append(el('span', 'delivers', task.delivers.join(', ')))
    if (task.removed) line.append(el('span', 'badge removed', 'removed'))
    else if (started) line.append(el('span', `badge state ${task.state}`, blockedReason(task) ?? TASK_STATE[task.state]))
    row.append(line)
    if (task.files.length > 0) {
      const files = el('div', 'files')
      for (const file of task.files) files.append(fileLink(file))
      row.append(files)
    }
    return row
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

  // --- the rendered spec, item by item ----------------------------------------

  /** Attaches the review to the rendered markdown: the whole-plan row under the title, then every list item and table row that starts with an item id. */
  private decorate(body: HTMLElement, plan: PlanState): void {
    const whole = this.wholePlanRow(plan)
    const title = body.querySelector('h1')
    if (title) title.after(whole)
    else body.prepend(whole)
    for (const line of body.querySelectorAll<HTMLElement>('li, tr')) {
      const id = ITEM_ID.exec(line.textContent ?? '')?.[1]
      const item = id ? plan.items.find((i) => i.id === id) : undefined
      if (!item) continue
      if (line instanceof HTMLTableRowElement) this.decorateRow(line, plan, item)
      else this.decorateListItem(line, plan, item)
    }
  }

  private wholePlanRow(plan: PlanState): HTMLElement {
    const row = el('div', 'item whole')
    const line = el('div', 'line')
    line.append(el('span', 'text', 'The plan as a whole'))
    if (plan.commentable) line.append(button('Comment', () => this.openEditor({ target: PLAN_TARGET, text: '' })))
    row.append(line, ...this.attachments(plan, PLAN_TARGET))
    return row
  }

  private decorateListItem(li: HTMLElement, plan: PlanState, item: PlanItem): void {
    li.classList.add('item')
    // The item's own line is wrapped so a strike hits it alone, not the comments or a nested list under it.
    const nested = li.querySelector(':scope > ul, :scope > ol')
    const text = wrapText(li, nested)
    text.after(this.controls(plan, item))
    if (struckItems(plan.review).includes(item.id) || item.removed) li.classList.add('struck')
    li.append(...this.attachments(plan, item.id))
  }

  private decorateRow(tr: HTMLTableRowElement, plan: PlanState, item: PlanItem): void {
    tr.classList.add('item')
    for (const cell of tr.cells) wrapText(cell, null)
    tr.cells[0]?.append(this.controls(plan, item))
    if (struckItems(plan.review).includes(item.id) || item.removed) tr.classList.add('struck')
    const attachments = this.attachments(plan, item.id)
    if (attachments.length === 0) return
    const extra = tr.insertAdjacentElement('afterend', el('tr', 'attachments')) as HTMLTableRowElement
    const cell = extra.insertCell()
    cell.colSpan = tr.cells.length
    cell.append(...attachments)
  }

  private controls(plan: PlanState, item: PlanItem): HTMLElement {
    const struck = struckItems(plan.review).includes(item.id)
    const controls = el('span', 'controls')
    if (item.removed) controls.append(el('span', 'badge removed', 'removed'))
    else if (struck) controls.append(el('span', 'badge struck', 'struck'))
    if (!plan.commentable) return controls
    controls.append(button('Comment', () => this.openEditor({ target: item.id, text: '' })))
    const pending = pendingRound(plan.review)?.strikes.includes(item.id) ?? false
    if (!struck) controls.append(button('Strike', () => this.act({ type: 'strike_item', itemId: item.id })))
    else if (pending) controls.append(button('Unstrike', () => this.act({ type: 'unstrike_item', itemId: item.id })))
    return controls
  }

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

/** Moves the children of `parent` up to `before` (all of them when null) into a `span.text`, so a style can hit the line's own text alone. */
function wrapText(parent: HTMLElement, before: Element | null): HTMLElement {
  const text = el('span', 'text')
  while (parent.firstChild && parent.firstChild !== before) text.append(parent.firstChild)
  if (before) before.before(text)
  else parent.append(text)
  return text
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

/** `[blocked: reason]` as written; the reason is what the badge should say. */
function blockedReason(task: Task): string | undefined {
  const match = /\[blocked\s*:?\s*([^\]]*)\]/i.exec(task.text)
  if (!match) return undefined
  const reason = match[1]!.trim()
  return reason ? `blocked: ${reason}` : 'blocked'
}

function fileLink(path: string): HTMLButtonElement {
  const link = button(path, () => post({ type: 'open_file', path }))
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

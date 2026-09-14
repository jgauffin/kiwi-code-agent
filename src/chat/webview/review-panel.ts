import type { PlanState } from '../protocol'
import type { PlanItem, Review, ReviewComment } from '../../agent/phases/plan-review'
import { ReviewActionEvent } from './events'

const PLAN_TARGET = 'plan'

type Editor = { target: string; commentId?: string; text: string }

/**
 * The review of a draft plan: every item with the comments on it, the pending
 * batch as a whole, and each submitted comment with the agent's resolution.
 * Built by hand rather than from a template so an open comment box keeps its
 * text and caret while the plan around it is re-rendered.
 */
export class ReviewPanel extends HTMLElement {
  private plan: PlanState | undefined
  private editor: Editor | undefined
  private signature = ''

  update(plan: PlanState | undefined): void {
    const signature = JSON.stringify(plan ? { items: plan.items, review: plan.review, commentable: plan.commentable } : null)
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
    if (!plan) return
    if (!plan.commentable) {
      this.append(
        note(
          plan.status === 'approved'
            ? 'This plan is approved. Its review is kept as the record of how it was reached; reopen or supersede the plan to comment again.'
            : 'There is no draft plan to comment on yet.',
        ),
      )
    }
    this.append(this.pendingSection(plan), this.itemsSection(plan))
  }

  // --- the pending batch ------------------------------------------------------

  private pendingSection(plan: PlanState): HTMLElement {
    const round = pendingRound(plan.review)
    const section = el('section', 'pending')
    section.append(el('h3', 'heading', round ? `Pending review — round ${round.number}` : 'Pending review'))
    if (!round) {
      section.append(note('Nothing to send yet. Comment on an item below, or strike one.'))
      return section
    }
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

  // --- the plan, item by item -------------------------------------------------

  private itemsSection(plan: PlanState): HTMLElement {
    const section = el('section', 'items')
    section.append(this.targetRow(plan, PLAN_TARGET, 'The plan as a whole', undefined))
    let heading = ''
    for (const item of plan.items) {
      if (item.section !== heading) {
        heading = item.section
        section.append(el('h3', 'heading', heading))
      }
      section.append(this.targetRow(plan, item.id, `${item.id}: ${item.text}`, item))
    }
    return section
  }

  private targetRow(plan: PlanState, target: string, label: string, item: PlanItem | undefined): HTMLElement {
    const struck = struckItems(plan.review).includes(target)
    const row = el('div', `item${struck || item?.removed ? ' struck' : ''}`)
    const line = el('div', 'line')
    line.append(el('span', 'text', label))
    if (item?.removed) line.append(el('span', 'badge removed', 'removed'))
    else if (struck) line.append(el('span', 'badge struck', 'struck'))
    if (plan.commentable) {
      line.append(button('Comment', () => this.openEditor({ target, text: '' })))
      if (item) {
        const strikeable = !struck
        const pending = pendingRound(plan.review)?.strikes.includes(target) ?? false
        if (strikeable) line.append(button('Strike', () => this.act({ type: 'strike_item', itemId: target })))
        else if (pending) line.append(button('Unstrike', () => this.act({ type: 'unstrike_item', itemId: target })))
      }
    }
    row.append(line)
    const comments = commentsFor(plan.review, target)
    if (comments.length > 0) {
      const list = el('ul', 'comments')
      for (const comment of comments) list.append(this.commentRow(comment, plan, isPending(plan.review, comment.id)))
      row.append(list)
    }
    if (this.editor && this.editor.target === target && !this.editor.commentId) row.append(this.editorBox(this.editor))
    return row
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

function button(label: string, onClick: () => void, options: { title?: string } = {}): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  if (options.title) node.title = options.title
  node.addEventListener('click', onClick)
  return node
}

customElements.define('review-panel', ReviewPanel)

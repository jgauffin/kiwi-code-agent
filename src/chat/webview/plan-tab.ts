import type { PlanState, ReviewAction } from '../protocol'
import { EditorClosedEvent, PlanFocusRequestedEvent, ReviewActionEvent } from './events'
import type { CommentRow } from './plan-comments'
import type { Editor } from './plan-parts'

/** What the comment markup calls; a tab spreads these into its functions context. */
type CommentFns = {
  focus: (name: string) => void
  edit: (row: CommentRow) => void
  remove: (row: CommentRow) => void
  resolve: (row: CommentRow) => void
}

/**
 * What every tab of the plan view has in common: the plan it draws, a redraw
 * of its own root, the review gestures on their way to the host, and the
 * handlers behind the comment markup the spec and review tabs share. A tab
 * keeps its own state between redraws, so an open editor survives the plan
 * changing under it; the view retains the element rather than building it
 * again.
 */
export abstract class PlanTab extends HTMLElement {
  protected plan: PlanState | undefined
  /** The comment or ruling being written on this tab, if any. */
  protected editor: Editor | undefined

  constructor() {
    super()
    this.addEventListener(EditorClosedEvent.type, (event) => {
      event.stopPropagation()
      this.closeEditor(event.text)
    })
  }

  update(plan: PlanState): void {
    this.plan = plan
    this.redraw()
  }

  /** Draws the tab into its own root; a templated tab patches what is already there rather than building it again. */
  protected abstract draw(plan: PlanState): void

  protected redraw(): void {
    if (this.plan) this.draw(this.plan)
  }

  protected act(action: ReviewAction): void {
    this.dispatchEvent(new ReviewActionEvent(action))
  }

  protected openEditor(editor: Editor | undefined): void {
    this.editor = editor
    this.redraw()
  }

  /** The box is gone either way; text means it was written rather than cancelled. */
  private closeEditor(text: string | undefined): void {
    const editor = this.editor
    this.editor = undefined
    if (editor && text !== undefined) this.saveEditor(editor, text)
    this.redraw()
  }

  protected commentFns(): CommentFns {
    return {
      focus: (name) => this.dispatchEvent(new PlanFocusRequestedEvent('spec', { item: name })),
      edit: (row) => this.openEditor({ kind: 'comment', target: row.target, comment: row.ref, text: row.text }),
      remove: (row) => this.act({ type: 'remove_comment', comment: row.ref }),
      resolve: (row) => this.act({ type: 'resolve_comment', comment: row.ref }),
    }
  }

  /** What a written editor does when saved; the decisions tab also writes rulings. */
  protected saveEditor(editor: Editor, text: string): void {
    if (editor.kind === 'comment' && editor.comment) this.act({ type: 'edit_comment', comment: editor.comment, text })
    else this.act({ type: 'add_comment', target: editor.target, text })
  }
}

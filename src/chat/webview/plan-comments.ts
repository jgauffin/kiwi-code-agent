import type { PlanState } from '../protocol'
import type { CommentRef } from '../../agent/phases/plan-review'
import { PLAN_TARGET, sameRef, type Editor, type PlacedComment } from './plan-parts'
import './plan-editor'

export type CommentRow = {
  ref: CommentRef
  className: string
  editing: boolean
  shown: boolean
  editable: boolean
  linked: boolean
  target: string
  targetLabel: string
  text: string
  resolved: boolean
  resolutionKind: string
  resolutionText: string
  resolvable: boolean
  resolveTitle: string
  awaiting: boolean
  editorText: string
}

/**
 * A comment as written with its answer beneath it, the same on the spec tab
 * and the review tab. The collection differs — the review nests comments under
 * rounds, the spec under rules — so the path comes in and the row alias is
 * always `c`. The handlers are on the tab, from `commentFns`.
 */
export const commentMarkup = (comments: string): string => `
  <li loop="c in ${comments}" class="{{c.className}}">
    <plan-editor class="editor" if="c.editing" label="Save" placeholder="What is wrong with it?" text="{{c.editorText}}"></plan-editor>
    <div class="on" if="c.linked">
      <span class="label">on </span>
      <button type="button" class="link item" title="Show the rule on the Spec tab." r-click="focus(c.target)">{{c.targetLabel}}</button>
    </div>
    <div class="line" if="c.shown">
      <span class="text">{{c.text}}</span>
      <span class="controls" if="c.editable">
        <button type="button" r-click="edit(c)">Edit</button>
        <button type="button" r-click="remove(c)">Remove</button>
      </span>
    </div>
    <div class="resolution {{c.resolutionKind}}" if="c.resolved">
      <span class="kind">{{c.resolutionKind}}</span>
      <span class="text">{{c.resolutionText}}</span>
      <button type="button" if="c.resolvable" title="{{c.resolveTitle}}" r-click="resolve(c)">Resolve</button>
    </div>
    <div class="awaiting" if="c.awaiting">waiting for the agent to resolve this</div>
  </li>`

/** `linked` names the rule each comment is on, for the review tab where the rule is not in sight. */
export function commentRows(placed: PlacedComment[], plan: PlanState, linked: boolean, editor: Editor | undefined): CommentRow[] {
  return placed.map(({ ref, comment, pending }) => {
    const editing = editor?.kind === 'comment' && editor.comment !== undefined && sameRef(editor.comment, ref)
    const resolution = comment.resolution
    const closed = comment.closed ?? false
    return {
      ref,
      className: `comment${closed ? ' closed' : ' open'}${resolution !== undefined && !closed ? ' attention' : ''}`,
      editing,
      shown: !editing,
      editable: pending && plan.commentable,
      linked: linked && !editing,
      target: comment.target,
      targetLabel: comment.target === PLAN_TARGET ? 'the plan as a whole' : comment.target,
      text: comment.text,
      resolved: !editing && resolution !== undefined,
      resolutionKind: resolution?.kind ?? '',
      resolutionText: resolution?.text ?? '',
      resolvable: !closed,
      resolveTitle: resolution?.kind === 'disagreed' ? 'Close this comment although the agent disagreed with it.' : 'Close this comment.',
      awaiting: !editing && resolution === undefined && !pending,
      editorText: editor?.text ?? '',
    }
  })
}

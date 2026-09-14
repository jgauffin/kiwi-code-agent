import { renderMarkdown } from './markdown'

/** The spec, rendered where the transcript normally is. */
export class PlanView extends HTMLElement {
  private body: string | undefined

  update(body: string | undefined): void {
    if (body === this.body) return
    this.body = body
    renderMarkdown(body ?? '', this, true)
  }
}

customElements.define('plan-view', PlanView)

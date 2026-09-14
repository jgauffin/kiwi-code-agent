import { compileTemplate } from '@relax.js/core/html'
import type { PermissionDecision, SessionEvent } from '../../agent/session/code-session'
import { PermissionDecidedEvent } from './events'

type PermissionRequest = Extract<SessionEvent, { type: 'permission_request' }>

/** One tool permission prompt. Emits the decision; the parent forwards it. */
export class PermissionCard extends HTMLElement {
  private readonly template = compileTemplate(`
    <div class="prompt">
      <strong>{{title}}</strong>
      <p class="description" if="description">{{description}}</p>
      <pre class="input">{{input}}</pre>
    </div>
    <div class="actions" unless="decided">
      <button type="button" class="allow" r-click="decide('allow')">Allow</button>
      <button type="button" class="allow-always" if="canAllowAlways" r-click="decide('allow_always')">Always allow</button>
      <button type="button" class="deny" r-click="decide('deny')">Deny</button>
    </div>
    <p class="decision" if="decided">{{decided}}</p>
  `)
  private request: PermissionRequest | undefined
  private decided = ''

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  show(request: PermissionRequest): void {
    this.request = request
    this.render()
  }

  resolve(decision: PermissionDecision['kind']): void {
    this.decided = { allow: 'Allowed', allow_always: 'Allowed for this session', deny: 'Denied' }[decision]
    this.render()
  }

  private render(): void {
    const r = this.request
    if (!r) return
    this.template.render(
      {
        title: r.title ?? `${r.toolName}`,
        description: r.description ?? '',
        input: JSON.stringify(r.input, null, 2),
        canAllowAlways: r.canAllowAlways,
        decided: this.decided,
      },
      {
        decide: (kind: PermissionDecision['kind']) => {
          this.dispatchEvent(new PermissionDecidedEvent(r.requestId, { kind }))
        },
      },
    )
  }
}

customElements.define('permission-card', PermissionCard)

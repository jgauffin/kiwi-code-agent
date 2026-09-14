import { compileTemplate } from '@relax.js/core/html'
import type { PermissionDecision, SessionEvent } from '../../agent/session/code-session'
import { projectRulesFor, ruleLabel } from '../../agent/permissions/permission-rules'
import { editDiffView } from './edit-diff'
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
      <button type="button" class="allow" r-click="allow()">Allow</button>
      <button type="button" class="allow-project" if="rememberable" title="Writes {{rules}} to kiwiAgent.permissions.allow in this workspace." r-click="allowProject()">Allow {{label}} for project</button>
      <button type="button" class="deny" r-click="deny()">Deny</button>
    </div>
    <p class="decision" if="decided">{{decided}}</p>
  `)
  private request: PermissionRequest | undefined
  private rules: string[] = []
  private decided = ''
  private decision: PermissionDecision['kind'] | undefined
  private rememberedForProject = false

  connectedCallback(): void {
    if (this.childElementCount === 0) this.appendChild(this.template.content)
  }

  show(request: PermissionRequest): void {
    this.request = request
    this.rules = projectRulesFor(request.toolName, request.input)
    this.render()
  }

  resolve(decision: PermissionDecision['kind']): void {
    this.decision = decision
    this.decided = decision === 'deny' ? 'Denied' : this.rememberedForProject ? `Allowed for project (${ruleLabel(this.rules)})` : 'Allowed'
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
        // A file write is answered per call or with the session's "Allow writes" switch, never for the project.
        rememberable: this.rules.length > 0,
        label: ruleLabel(this.rules),
        rules: this.rules.join(', '),
        decided: this.decided,
      },
      {
        allow: () => this.dispatchEvent(new PermissionDecidedEvent(r.requestId, { kind: 'allow' })),
        allowProject: () => {
          this.rememberedForProject = true
          this.dispatchEvent(new PermissionDecidedEvent(r.requestId, { kind: 'allow_project', rules: this.rules }))
        },
        deny: () => this.dispatchEvent(new PermissionDecidedEvent(r.requestId, { kind: 'deny' })),
      },
    )
    this.showEdit(r)
  }

  /**
   * A file edit is asked about as the change it would make, not as the
   * arguments that would make it. A denied card drops the diff again: nothing
   * changed, so there is nothing to show but the outcome.
   */
  private showEdit(request: PermissionRequest): void {
    this.querySelector('.edit')?.remove()
    const input = this.querySelector('pre.input')
    if (!(input instanceof HTMLElement)) return
    const change = this.decision === 'deny' ? undefined : request.edit
    input.hidden = change !== undefined
    if (change) input.insertAdjacentElement('afterend', editDiffView(change))
  }
}

customElements.define('permission-card', PermissionCard)

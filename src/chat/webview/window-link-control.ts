import { compileTemplate } from '@relax.js/core/html'
import type { LinkAct, WindowLinkState } from '../../cross-window/cross-window'
import { WindowLinkRequestedEvent } from './events'

const LINE: Record<Exclude<WindowLinkState['state'], 'none'>, (workspace: string) => string> = {
  linked: (workspace) => `Linked to ${workspace}`,
  disconnected: (workspace) => `${workspace} window closed`,
  ended: (workspace) => `Link to ${workspace} ended`,
}

/**
 * A chat session's link to a chat session of another window: Link while it
 * has none, and while it has one, who it is with, Pause or Resume, and Unlink.
 * The code itself is made and entered in the editor, which owns the clipboard.
 */
export class WindowLinkControl extends HTMLElement {
  private readonly template = compileTemplate(`
    <span class="window-link {{state}}">
      <span class="with" if="shown" title="{{title}}">{{line}}</span>
      <button type="button" class="link" if="linkable" title="Link this chat to a chat session in another VS Code window, so the two agents can message each other." r-click="request('link')">Link window</button>
      <button type="button" class="pause" if="pausable" title="End both agents' turns and stop them messaging each other until you resume." r-click="request('pause')">Pause</button>
      <button type="button" class="resume" if="resumable" title="Let the two agents message each other again." r-click="request('resume')">Resume</button>
      <button type="button" class="unlink" if="unlinkable" title="End the link; neither agent can reach the other afterwards." r-click="request('unlink')">Unlink</button>
    </span>
  `)
  private link: WindowLinkState = { state: 'none' }

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  setLink(link: WindowLinkState): void {
    this.link = link
    this.render()
  }

  private render(): void {
    const link = this.link
    const open = link.state === 'linked' || link.state === 'disconnected'
    const paused = link.state !== 'none' && link.paused
    this.template.render(
      {
        state: paused && open ? 'paused' : link.state,
        shown: link.state !== 'none',
        line: link.state === 'none' ? '' : `${LINE[link.state](link.workspace)}${paused && open ? ', paused' : ''}`,
        title: link.state === 'none' ? '' : `This chat's agent can message the agent of the linked chat in the ${link.workspace} window.`,
        linkable: link.state === 'none' || link.state === 'ended',
        pausable: open && !paused,
        resumable: open && paused,
        unlinkable: open,
      },
      { request: (act: LinkAct) => this.dispatchEvent(new WindowLinkRequestedEvent(act)) },
    )
  }
}

customElements.define('window-link-control', WindowLinkControl)

import { compileTemplate } from '@relax.js/core/html'
import type { AgentsMdAnswer, AgentsMdOffer } from '../protocol'
import { AgentsMdAnsweredEvent } from './events'
import './markdown-text'

/**
 * What a scope's `AGENTS.md` still needs, put to the person over whatever the
 * tab shows, with the file rendered as the markdown it is: a `CLAUDE.md` to
 * move in, a tidy-up once it is long, or both. Closing it, by the cross or
 * Escape, puts it off until the next window.
 */
export class AgentsMdOverlay extends HTMLElement {
  private readonly template = compileTemplate(`
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="agents-md-title">
      <header>
        <h2 id="agents-md-title">{{title}}</h2>
        <button type="button" class="close" title="Ask again next window" aria-label="Close" r-click="later()">×</button>
      </header>
      <p class="lead">{{lead}}</p>
      <p class="paths">{{paths}}</p>
      <markdown-text block class="preview" text="{{text}}"></markdown-text>
      <footer class="actions">
        <button type="button" class="tidy" if="tidy" r-click="tidyUp()">{{tidyLabel}}</button>
        <button type="button" class="move" if="move" r-click="move()">Move</button>
        <button type="button" class="decline" title="Not offered again" r-click="decline()">Not now</button>
      </footer>
    </div>
  `)
  private offer: AgentsMdOffer | undefined

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.hidden = true
    this.appendChild(this.template.content)
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.answer('later')
    })
  }

  /** The state repeats the offer on every update; it is drawn again only when it changed, so the preview's scroll stays put. */
  show(offer: AgentsMdOffer | undefined): void {
    const same = offer && this.offer && JSON.stringify(offer) === JSON.stringify(this.offer)
    this.offer = offer
    this.hidden = !offer
    if (!offer || same) return
    const owner = offer.scope === 'user' ? 'your own' : "this workspace's"
    const move = offer.claudePath !== undefined
    const tidy = offer.tidyWords !== undefined
    const moveLead = `${capitalized(owner)} CLAUDE.md still holds rules. Both engines read AGENTS.md, so they move there and CLAUDE.md is removed.`
    const tidyLead = `At ${offer.tidyWords} words it is long for a file read into every turn. ${move ? 'Move and tidy up' : 'Tidy up'} starts a chat that proposes tighter wording first, and moving things into docs only where that is not enough; nothing is written until you agree.`
    this.template.render(
      {
        title: move ? `Move ${owner} CLAUDE.md into AGENTS.md?` : `Tidy up ${owner} AGENTS.md?`,
        lead: [move ? moveLead : '', tidy ? tidyLead : ''].filter(Boolean).join(' '),
        paths: move ? `${offer.claudePath} → ${offer.agentsPath}` : offer.agentsPath,
        text: offer.text,
        move,
        tidy,
        tidyLabel: move ? 'Move and tidy up' : 'Tidy up',
      },
      {
        tidyUp: () => this.answer('tidy'),
        move: () => this.answer('move'),
        decline: () => this.answer('decline'),
        later: () => this.answer('later'),
      },
    )
    this.querySelector<HTMLButtonElement>('.actions button')?.focus()
  }

  private answer(answer: AgentsMdAnswer): void {
    const offer = this.offer
    if (!offer || this.hidden) return
    this.hidden = true
    this.dispatchEvent(new AgentsMdAnsweredEvent(offer.scope, answer))
  }
}

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

customElements.define('agents-md-overlay', AgentsMdOverlay)

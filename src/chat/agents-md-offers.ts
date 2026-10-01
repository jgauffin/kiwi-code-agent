import { moveOfferDue, type PendingMove } from '../agent/instructions/claude-md-move'
import { ownWords, TIDY_WORDS } from '../agent/instructions/agents-md-tidy'
import { parseAppliedBundles, type BundleScope } from '../agent/instructions/bundles'
import type { AgentsMdAnswer, AgentsMdOffer } from './protocol'

/** Each is put to the person once per scope: taken or turned down, it is not raised again. */
export type OfferKind = 'move' | 'tidy'

/** Where the offers come from and where an answer lands. */
export type AgentsMdOfferPorts = {
  pendingMove: (scope: BundleScope) => Promise<PendingMove | undefined>
  readAgentsMd: (scope: BundleScope) => Promise<{ path: string; text: string | undefined }>
  settled: (scope: BundleScope, kind: OfferKind) => boolean
  settle: (scope: BundleScope, kind: OfferKind) => Promise<void>
  applyMove: (move: PendingMove) => Promise<void>
}

/** A tidy-up the person asked for: the chat that does it is started on this file, told which shared rule sets it holds. */
export type TidyRequest = { scope: BundleScope; agentsPath: string; bundles: string[] }

type Offer = { scope: BundleScope; agentsPath: string; text: string; move?: PendingMove; tidyWords?: number }

/**
 * What is still to be put to the person about each scope's `AGENTS.md` in
 * this window, shown over the chat one scope at a time: a `CLAUDE.md` to move
 * in, a tidy-up once the file is long, or both at once.
 */
export class AgentsMdOffers {
  private offers: Offer[] = []

  constructor(
    private readonly ports: AgentsMdOfferPorts,
    private readonly changed: () => void,
  ) {}

  /** `scopes` in the order they are offered. */
  async load(scopes: BundleScope[]): Promise<void> {
    const offers: Offer[] = []
    for (const scope of scopes) {
      const offer = await this.offerFor(scope)
      if (offer) offers.push(offer)
    }
    this.offers = offers
    this.changed()
  }

  current(): AgentsMdOffer | undefined {
    const offer = this.offers[0]
    if (!offer) return undefined
    return {
      scope: offer.scope,
      agentsPath: offer.agentsPath,
      text: offer.text,
      ...(offer.move ? { claudePath: offer.move.claudePath } : {}),
      ...(offer.tidyWords !== undefined ? { tidyWords: offer.tidyWords } : {}),
    }
  }

  /**
   * The files are read again before a move: something else may have written
   * `AGENTS.md` while the offer stood open, and the person confirmed the text
   * they were shown. When it no longer matches, the offer is shown again with
   * what the move would now write. The offer is taken off before anything is
   * written, so a second click cannot apply it twice.
   */
  async answer(scope: BundleScope, answer: AgentsMdAnswer): Promise<TidyRequest | undefined> {
    const shown = this.offers.find((o) => o.scope === scope)
    if (!shown) return undefined
    this.offers = this.offers.filter((o) => o !== shown)
    try {
      if (answer === 'later') return undefined
      if (answer === 'decline') {
        if (shown.move) await this.ports.settle(scope, 'move')
        if (shown.tidyWords !== undefined) await this.ports.settle(scope, 'tidy')
        return undefined
      }
      if (shown.move) {
        const fresh = await this.ports.pendingMove(scope)
        if (fresh && fresh.mergedText !== shown.move.mergedText) {
          const again = await this.offerFor(scope)
          if (again) this.offers = [again, ...this.offers]
          return undefined
        }
        if (fresh) await this.ports.applyMove(fresh)
      }
      if (shown.tidyWords === undefined) return undefined
      await this.ports.settle(scope, 'tidy')
      if (answer !== 'tidy') return undefined
      return { scope, agentsPath: shown.agentsPath, bundles: parseAppliedBundles(shown.text, scope).map((b) => b.name) }
    } finally {
      this.changed()
    }
  }

  private async offerFor(scope: BundleScope): Promise<Offer | undefined> {
    const found = await this.ports.pendingMove(scope)
    const move = found && moveOfferDue(found, this.ports.settled(scope, 'move')) ? found : undefined
    const agents = move ? { path: move.agentsPath, text: move.mergedText } : await this.ports.readAgentsMd(scope)
    if (agents.text === undefined) return undefined
    const words = ownWords(agents.text)
    const tidy = words > TIDY_WORDS && !this.ports.settled(scope, 'tidy')
    if (!move && !tidy) return undefined
    return { scope, agentsPath: agents.path, text: agents.text, ...(move ? { move } : {}), ...(tidy ? { tidyWords: words } : {}) }
  }
}

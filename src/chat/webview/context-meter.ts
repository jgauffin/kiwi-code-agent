import { compileTemplate } from '@relax.js/core/html'
import { compact } from './format-usage'
import { CompactRequestedEvent } from './events'

/** How full the conversation's window is, as the engine last said, and where the session compacts. */
export type ContextUsage = { usedTokens: number; windowTokens: number; compactAtTokens: number }

/** Below this share of the window left, the engine is close to compacting or refusing; the reader is warned. */
const LOW_SHARE_LEFT = 0.2

/**
 * How much of the conversation's window is still free, and the button that
 * folds the conversation into a summary to make room. Hidden until the engine
 * has said how full it is.
 */
export class ContextMeter extends HTMLElement {
  private readonly template = compileTemplate(`
    <span if="known" class="left {{level}}" title="{{detail}}">{{percentLeft}}% context left</span>
    <button type="button" class="compact" disabled="{{off}}" title="{{buttonTitle}}" aria-label="Compact the conversation" r-click="compact()">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 1.5 8 4.5 11 1.5M5 14.5 8 11.5 11 14.5M2 8h12"/>
      </svg>
    </button>
  `)
  private usage: ContextUsage | undefined
  private compactable = false

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  update(usage: ContextUsage | undefined, compactable: boolean): void {
    this.usage = usage
    this.compactable = compactable
    this.render()
  }

  private render(): void {
    const usage = this.usage
    const shareLeft = usage && usage.windowTokens > 0 ? Math.max(0, 1 - usage.usedTokens / usage.windowTokens) : 1
    this.template.render(
      {
        known: usage !== undefined,
        percentLeft: Math.round(shareLeft * 100),
        level: shareLeft < LOW_SHARE_LEFT ? 'low' : '',
        detail: usage ? this.detail(usage) : '',
        off: !this.compactable,
        buttonTitle: this.compactable
          ? 'Compact: fold the conversation into a summary to make room. A turn under way carries on after it.'
          : 'Nothing to compact: no engine holds this conversation right now.',
      },
      { compact: () => this.dispatchEvent(new CompactRequestedEvent()) },
    )
  }

  private detail(usage: ContextUsage): string {
    const inUse = `${compact(usage.usedTokens)} of ${compact(usage.windowTokens)} tokens in use`
    // A run log from before sessions reported where they compact replays without it.
    return usage.compactAtTokens ? `${inUse}; compacts at ${compact(usage.compactAtTokens)}` : inUse
  }
}

customElements.define('context-meter', ContextMeter)

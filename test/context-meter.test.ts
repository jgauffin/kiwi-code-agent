// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {} })

const { ContextMeter } = await import('../src/chat/webview/context-meter')
const { CompactRequestedEvent } = await import('../src/chat/webview/events')

function meter(): InstanceType<typeof ContextMeter> {
  const node = new ContextMeter()
  document.body.appendChild(node)
  return node
}

describe('ContextMeter', () => {
  it('shows_the_share_of_the_window_still_free', () => {
    const node = meter()
    node.update({ usedTokens: 150_000, windowTokens: 200_000, compactAtTokens: 160_000 }, true)
    expect(node.querySelector('.left')!.textContent!.trim()).toBe('25% context left')
    expect(node.querySelector('.left')!.getAttribute('title')).toBe('150.0K of 200.0K tokens in use; compacts at 160.0K')
  })

  it('nothing_is_shown_before_the_engine_has_said_how_full_it_is', () => {
    const node = meter()
    node.update(undefined, true)
    expect(node.querySelector('.left')).toBeNull()
  })

  it('a_nearly_full_window_is_marked', () => {
    const node = meter()
    node.update({ usedTokens: 190_000, windowTokens: 200_000, compactAtTokens: 150_000 },true)
    expect(node.querySelector('.left')!.classList.contains('low')).toBe(true)
    node.update({ usedTokens: 20_000, windowTokens: 200_000, compactAtTokens: 150_000 },true)
    expect(node.querySelector('.left')!.classList.contains('low')).toBe(false)
  })

  it('the_compact_button_asks_for_a_compaction_while_the_engine_runs', () => {
    const node = meter()
    let asked = 0
    node.addEventListener(CompactRequestedEvent.type, () => asked++)
    node.update({ usedTokens: 20_000, windowTokens: 200_000, compactAtTokens: 150_000 },true)
    node.querySelector<HTMLButtonElement>('button.compact')!.click()
    expect(asked).toBe(1)
  })

  it('the_compact_button_is_off_while_no_engine_holds_the_conversation', () => {
    const node = meter()
    node.update({ usedTokens: 20_000, windowTokens: 200_000, compactAtTokens: 150_000 },false)
    expect(node.querySelector<HTMLButtonElement>('button.compact')!.disabled).toBe(true)
  })
})

/**
 * The chat font size follows the editor, but a webview only sees the *configured* editor size: a
 * transient editor font zoom is invisible to it. kiwiAgent.fontSize is how the reader matches it by eye.
 *
 * Anything outside the range is ignored rather than clamped: a stray value in settings should leave the
 * webview on its own scale, not silently move it somewhere nearby.
 */
const smallest = 8
const largest = 40

/** The inline style that overrides the root font size, or nothing when the setting is off or unusable. */
export function fontSizeStyle(configured: unknown): string {
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return ''
  if (configured < smallest || configured > largest) return ''
  return `<style>:root{font-size:${configured}px}</style>`
}

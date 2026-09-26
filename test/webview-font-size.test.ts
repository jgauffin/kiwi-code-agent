import { describe, expect, it } from 'vitest'
import { fontSizeStyle } from '../src/chat/webview-font-size'

describe('chat font size override', () => {
  it('follows_the_editor_when_the_setting_is_off', () => {
    expect(fontSizeStyle(0)).toBe('')
  })

  it('overrides_the_root_size_when_a_size_is_configured', () => {
    expect(fontSizeStyle(16)).toBe('<style>:root{font-size:16px}</style>')
  })

  it('ignores_a_size_that_would_make_the_view_unreadable', () => {
    expect(fontSizeStyle(2)).toBe('')
    expect(fontSizeStyle(400)).toBe('')
  })

  it('ignores_a_setting_that_is_not_a_number', () => {
    expect(fontSizeStyle('16px')).toBe('')
    expect(fontSizeStyle(undefined)).toBe('')
    expect(fontSizeStyle(Number.NaN)).toBe('')
  })
})

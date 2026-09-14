// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderAnsi } from '../src/chat/webview/ansi'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

function render(text: string): HTMLElement {
  const into = document.createElement('pre')
  renderAnsi(text, into)
  return into
}

const spans = (el: HTMLElement) => [...el.querySelectorAll('span')]

describe('ANSI output in the transcript', () => {
  it('plain_text_lands_as_is_without_any_span', () => {
    const el = render('all 12 tests passed\n')
    expect(el.textContent).toBe('all 12 tests passed\n')
    expect(spans(el)).toHaveLength(0)
  })

  it('a_colour_sequence_becomes_a_span_named_after_the_terminal_colour_and_no_control_chars_remain', () => {
    const el = render(`${ESC}[31mFAIL${ESC}[39m test/x.test.ts`)
    expect(el.textContent).toBe('FAIL test/x.test.ts')
    expect(spans(el).map((s) => [s.textContent, s.className])).toEqual([['FAIL', 'ansi-fg-Red']])
  })

  it('bright_colours_and_backgrounds_get_their_own_names', () => {
    const el = render(`${ESC}[92mok${ESC}[0m ${ESC}[41mbad${ESC}[0m`)
    expect(spans(el).map((s) => s.className)).toEqual(['ansi-fg-BrightGreen', 'ansi-bg-Red'])
  })

  it('bold_dim_italic_underline_and_strikethrough_stack_until_each_is_switched_off', () => {
    const el = render(`${ESC}[1;4mhead${ESC}[22ming${ESC}[24m${ESC}[2;3;9mtail${ESC}[0m`)
    expect(spans(el).map((s) => [s.textContent, s.className])).toEqual([
      ['head', 'ansi-bold ansi-underline'],
      ['ing', 'ansi-underline'],
      ['tail', 'ansi-dim ansi-italic ansi-strike'],
    ])
  })

  it('a_reset_clears_colour_and_style_together', () => {
    const el = render(`${ESC}[1;32m✓${ESC}[0m passed`)
    expect(spans(el)).toHaveLength(1)
    expect(el.lastChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(el.lastChild?.textContent).toBe(' passed')
  })

  it('a_bare_m_sequence_means_reset', () => {
    const el = render(`${ESC}[33mwarn${ESC}[m done`)
    expect(spans(el).map((s) => s.textContent)).toEqual(['warn'])
    expect(el.textContent).toBe('warn done')
  })

  it('256_colour_and_truecolour_sequences_become_inline_colours', () => {
    const el = render(`${ESC}[38;5;208mo${ESC}[0m${ESC}[48;2;10;20;30mb${ESC}[0m${ESC}[38;5;1mr${ESC}[0m`)
    const [orange, blue, red] = spans(el)
    expect(orange?.style.color).toBe('rgb(255, 135, 0)')
    expect(orange?.className).toBe('')
    expect(blue?.style.backgroundColor).toBe('rgb(10, 20, 30)')
    // The first sixteen of the 256 are the terminal's own colours, themed like the plain sequences.
    expect(red?.className).toBe('ansi-fg-Red')
  })

  it('cursor_and_erase_sequences_are_dropped_and_leave_no_span', () => {
    const el = render(`${ESC}[2K${ESC}[1Gline${ESC}[?25h`)
    expect(el.textContent).toBe('line')
    expect(spans(el)).toHaveLength(0)
  })

  it('a_hyperlink_sequence_is_dropped_but_its_text_stays', () => {
    const el = render(`${ESC}]8;;https://x.test${ESC}\\file.ts${ESC}]8;;${ESC}\\ and ${ESC}]0;title${BEL}after`)
    expect(el.textContent).toBe('file.ts and after')
  })

  it('an_unterminated_sequence_at_the_end_is_dropped_rather_than_shown', () => {
    const el = render(`text${ESC}[3`)
    expect(el.textContent).toBe('text')
  })
})

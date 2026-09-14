/**
 * Terminal output as the terminal would show it: SGR colour and style
 * sequences become spans, every other escape sequence (cursor moves, erases,
 * hyperlinks, titles) is dropped, since the transcript is not a screen.
 */

const COLOURS = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']

type Style = {
  /** A terminal colour name (`Red`, `BrightRed`), themed by CSS, or a CSS `rgb()` for the wider palettes. */
  fg?: string
  bg?: string
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

const PLAIN: Style = { bold: false, dim: false, italic: false, underline: false, strike: false }

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

// SGR (`ESC [ … m`) is captured; other CSI (also one cut off by the end of the
// output), OSC (BEL- or ST-terminated) and lone ESC pairs match without a group.
const SEQUENCE = new RegExp(
  [`${ESC}\\[([0-9;]*)m`, `${ESC}\\[[0-?]*[ -/]*(?:[@-~]|$)`, `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, `${ESC}[\\s\\S]?`].join('|'),
  'g',
)

export function renderAnsi(text: string, into: HTMLElement): void {
  let style = PLAIN
  let last = 0
  for (const match of text.matchAll(SEQUENCE)) {
    emit(into, text.slice(last, match.index), style)
    last = match.index + match[0].length
    if (match[1] !== undefined) style = apply(style, match[1])
  }
  emit(into, text.slice(last), style)
}

function emit(into: HTMLElement, text: string, style: Style): void {
  if (text === '') return
  if (style === PLAIN) {
    into.appendChild(document.createTextNode(text))
    return
  }
  const span = document.createElement('span')
  const classes: string[] = []
  for (const flag of ['bold', 'dim', 'italic', 'underline', 'strike'] as const) if (style[flag]) classes.push(`ansi-${flag}`)
  if (style.fg) style.fg.startsWith('rgb(') ? (span.style.color = style.fg) : classes.push(`ansi-fg-${style.fg}`)
  if (style.bg) style.bg.startsWith('rgb(') ? (span.style.backgroundColor = style.bg) : classes.push(`ansi-bg-${style.bg}`)
  span.className = classes.join(' ')
  span.textContent = text
  into.appendChild(span)
}

function apply(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(';').map((p) => Number(p) || 0)
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) next = { ...PLAIN }
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 9) next.strike = true
    else if (code === 22) next.bold = next.dim = false
    else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 29) next.strike = false
    else if (code >= 30 && code <= 37) next.fg = COLOURS[code - 30]!
    else if (code >= 90 && code <= 97) next.fg = `Bright${COLOURS[code - 90]}`
    else if (code === 39) delete next.fg
    else if (code >= 40 && code <= 47) next.bg = COLOURS[code - 40]!
    else if (code >= 100 && code <= 107) next.bg = `Bright${COLOURS[code - 100]}`
    else if (code === 49) delete next.bg
    else if (code === 38 || code === 48) {
      const [colour, used] = extended(codes, i + 1)
      i += used
      if (colour) code === 38 ? (next.fg = colour) : (next.bg = colour)
    }
  }
  return isPlain(next) ? PLAIN : next
}

/** `5;n` (256-colour) or `2;r;g;b` (truecolour) after a 38/48; returns the colour and how many codes it consumed. */
function extended(codes: number[], at: number): [string | undefined, number] {
  if (codes[at] === 5 && codes[at + 1] !== undefined) return [palette256(codes[at + 1]!), 2]
  if (codes[at] === 2 && codes[at + 3] !== undefined) return [`rgb(${codes[at + 1]}, ${codes[at + 2]}, ${codes[at + 3]})`, 4]
  return [undefined, 0]
}

function palette256(n: number): string {
  if (n < 8) return COLOURS[n]!
  if (n < 16) return `Bright${COLOURS[n - 8]}`
  if (n >= 232) {
    const grey = 8 + (n - 232) * 10
    return `rgb(${grey}, ${grey}, ${grey})`
  }
  const i = n - 16
  const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
  return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`
}

function isPlain(style: Style): boolean {
  return !style.fg && !style.bg && !style.bold && !style.dim && !style.italic && !style.underline && !style.strike
}

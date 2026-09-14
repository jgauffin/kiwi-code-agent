import { extname } from 'node:path'

/**
 * What the size measure needs to know about a language: how units are
 * delimited, and which literal syntaxes can hide a brace. Anything not listed
 * here is measured as a file only.
 */
export type Language = {
  family: 'brace' | 'python'
  lineComments: string[]
  blockComments: 'none' | 'flat' | 'nested'
  /** `'` opens a string; otherwise it is a character literal (or a Rust lifetime) and never spans code. */
  singleQuoteStrings: boolean
  /** Backtick literals: raw text, or a template whose `${…}` holes hold code. */
  backtick: 'none' | 'raw' | 'template'
  /** `"""…"""` blocks (and `'''` where `'` is a string quote). */
  tripleQuotes: boolean
  /** `${…}` holes inside ordinary and triple-quoted strings. */
  dollarHoles: boolean
  /** `@"…"`, `$"…"` and raw `"""` strings. */
  csharpStrings: boolean
  /** `r#"…"#`, `b"…"`, and `'a` lifetimes beside `'a'` chars. */
  rustStrings: boolean
  /** `R"delim(…)delim"`. */
  cRawStrings: boolean
  /** A line starting with `#` is a directive, blanked whole. */
  preprocessor: boolean
  /** `#"…"#` and `\(…)` interpolation. */
  swiftStrings: boolean
}

const BRACE: Language = {
  family: 'brace',
  lineComments: ['//'],
  blockComments: 'flat',
  singleQuoteStrings: false,
  backtick: 'none',
  tripleQuotes: false,
  dollarHoles: false,
  csharpStrings: false,
  rustStrings: false,
  cRawStrings: false,
  preprocessor: false,
  swiftStrings: false,
}

const JS: Language = { ...BRACE, singleQuoteStrings: true, backtick: 'template' }
const CS: Language = { ...BRACE, csharpStrings: true, tripleQuotes: true }
const JAVA: Language = { ...BRACE, tripleQuotes: true }
const GO: Language = { ...BRACE, backtick: 'raw' }
const RUST: Language = { ...BRACE, blockComments: 'nested', rustStrings: true }
const KOTLIN: Language = { ...BRACE, blockComments: 'nested', tripleQuotes: true, dollarHoles: true }
const SWIFT: Language = { ...BRACE, blockComments: 'nested', tripleQuotes: true, swiftStrings: true }
const C: Language = { ...BRACE, cRawStrings: true, preprocessor: true }
const PHP: Language = { ...BRACE, lineComments: ['//', '#'], singleQuoteStrings: true }
const PYTHON: Language = {
  family: 'python',
  lineComments: ['#'],
  blockComments: 'none',
  singleQuoteStrings: true,
  backtick: 'none',
  tripleQuotes: true,
  dollarHoles: false,
  csharpStrings: false,
  rustStrings: false,
  cRawStrings: false,
  preprocessor: false,
  swiftStrings: false,
}

const BY_EXTENSION: Record<string, Language> = {
  '.ts': JS,
  '.tsx': JS,
  '.mts': JS,
  '.cts': JS,
  '.js': JS,
  '.jsx': JS,
  '.mjs': JS,
  '.cjs': JS,
  '.cs': CS,
  '.java': JAVA,
  '.go': GO,
  '.rs': RUST,
  '.kt': KOTLIN,
  '.kts': KOTLIN,
  '.swift': SWIFT,
  '.c': C,
  '.h': C,
  '.cc': C,
  '.cpp': C,
  '.cxx': C,
  '.hpp': C,
  '.hh': C,
  '.php': PHP,
  '.py': PYTHON,
}

export function languageOf(path: string): Language | undefined {
  return BY_EXTENSION[extname(path).toLowerCase()]
}

/**
 * Variables a line sets to a literal and then uses: `S=out; ls > $S/a.log`
 * names the same file as `ls > out/a.log`, and is judged as that. A variable
 * stands for its value only where nothing in the line could leave it unset or
 * set it to something else; anywhere else it stays unsettled and is asked about.
 */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/

/** A plain `$NAME` or `${NAME}` at `at`, and the index just past it; any other form of expansion is not one. */
export function plainReferenceAt(src: string, at: number): { name: string; end: number } | undefined {
  if (src[at] !== '$') return undefined
  const braced = src[at + 1] === '{'
  const from = at + (braced ? 2 : 1)
  const name = NAME.exec(src.slice(from))?.[0]
  if (name === undefined) return undefined
  const end = from + name.length
  if (!braced) return { name, end }
  return src[end] === '}' ? { name, end: end + 1 } : undefined
}

/** A value that names one path as written: unquoted, it neither splits into words, globs nor expands further. */
export function isLiteralValue(value: string): boolean {
  const rest = value.startsWith('~/') ? value.slice(2) : value
  return value !== '' && !/[\s$`*?[\]{}~'"]/.test(rest)
}

/**
 * Is the name bound in one place in the whole line? Any other bare mention of
 * it (a second assignment, `read S`, `for S in`, `unset S`, `(( S++ ))`) could
 * change what it holds, in a loop even before the place it is used.
 */
export function boundOnce(src: string, name: string): boolean {
  return (src.match(new RegExp(`(?<![\\w$\\{-])${name}(?!\\w)`, 'g')) ?? []).length === 1
}

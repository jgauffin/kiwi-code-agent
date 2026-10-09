/**
 * How one command reads its own flags, so `-rf`, `-r -f` and `--recursive
 * --force` come out the same. A flag not described is kept as written, which
 * matches nothing a kept answer names under a long name: an unknown flag never
 * slips under a rule written for a known one.
 */
export type FlagSpec = {
  /** A short letter, or a single-dash word such as PowerShell's `-Recurse`, and the long name it stands for. */
  short?: Readonly<Record<string, string>>
  /** Long names that take a value, attached with `=` or as the next word. */
  valued?: readonly string[]
  /** Long names that take none, so an abbreviation of one is read as it. */
  long?: readonly string[]
}

export type ParsedArgs = {
  /** Each flag under its long name, with its value when it takes one. */
  flags: Map<string, string | true>
  operands: string[]
}

export function parseArgs(args: readonly string[], spec: FlagSpec = {}): ParsedArgs {
  const flags = new Map<string, string | true>()
  const operands: string[] = []
  const valued = new Set(spec.valued ?? [])
  const longNames = [...valued, ...(spec.long ?? []), ...Object.values(spec.short ?? {})]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    if (arg.length < 2 || !arg.startsWith('-')) {
      operands.push(arg)
      continue
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=')
      const written = equals === -1 ? arg : arg.slice(0, equals)
      const name = longName(written, longNames)
      if (equals !== -1) flags.set(name, arg.slice(equals + 1))
      else if (valued.has(name) && i + 1 < args.length) flags.set(name, args[++i]!)
      else flags.set(name, true)
      continue
    }
    const word = wordFlag(arg, spec.short)
    if (word !== undefined) {
      if (valued.has(word) && i + 1 < args.length) flags.set(word, args[++i]!)
      else flags.set(word, true)
      continue
    }
    const letters = arg.slice(1)
    for (let at = 0; at < letters.length; at++) {
      const name = spec.short?.[letters[at]!] ?? `-${letters[at]}`
      if (valued.has(name)) {
        const rest = letters.slice(at + 1).replace(/^=/, '')
        if (rest !== '') flags.set(name, rest)
        else if (i + 1 < args.length) flags.set(name, args[++i]!)
        else flags.set(name, true)
        break
      }
      flags.set(name, true)
    }
  }
  return { flags, operands }
}

/** GNU tools take any unambiguous abbreviation of a long flag. */
function longName(written: string, names: readonly string[]): string {
  if (names.includes(written)) return written
  const matches = [...new Set(names.filter((name) => name.startsWith('--') && name.startsWith(written)))]
  return matches.length === 1 ? matches[0]! : written
}

/** A single-dash word named whole in `short`, PowerShell style, without regard to case. */
function wordFlag(arg: string, short: FlagSpec['short']): string | undefined {
  if (!short || arg.length < 3) return undefined
  const word = arg.slice(1).toLowerCase()
  const key = Object.keys(short).find((k) => k.length > 1 && k.toLowerCase() === word)
  return key === undefined ? undefined : short[key]
}

export const hasFlag = (parsed: ParsedArgs, ...names: string[]): boolean => names.some((name) => parsed.flags.has(name))

export function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

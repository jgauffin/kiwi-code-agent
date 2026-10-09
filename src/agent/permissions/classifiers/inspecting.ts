import { effects, refused, type Effect, USE_FILE_TOOLS } from '../effects'
import { flagValue, hasFlag, type FlagSpec } from '../flags'
import type { Reach } from '../places'
import { atCwd, fileEffect, fileEffects, reachesFromCwd, writeOrDestroy, type CommandCall, type CommandClassifier, type CommandSite } from './classifier'

/** Commands that touch no file and nothing else whatever their arguments: they print, test or set the shell's own state. */
export const touchesNothing: CommandClassifier = {
  names: [
    'echo', 'printf', 'true', 'false', 'test', '[', '[[', 'which', 'type', 'where', 'whoami', 'uname', 'printenv',
    'basename', 'dirname', 'realpath', 'readlink', 'tasklist', 'ps', 'uptime', 'pwd', 'sleep', 'tr', 'df',
    // Shell builtins that touch only the shell's own state. `eval`, `exec`, `source`, `.` and `trap` run code and are not here.
    ':', 'read', 'export', 'unset', 'set', 'shift', 'local', 'declare', 'typeset', 'readonly', 'break', 'continue', 'return', 'exit', 'wait',
  ],
  classify: () => effects(),
}

/** What a reader does when it names no file: reads its input, or looks where the shell stands. */
type NoOperand = 'input' | Reach

type ReaderShape = {
  names: string[]
  flags?: FlagSpec
  /** The first operand is a pattern or a script rather than a file, unless one of these flags supplies it. */
  patternUnless?: string[]
  /** Flags whose value is a file it reads, such as grep's `-f`. */
  readsValueOf?: string[]
  /** How far each named path reaches. */
  extent: (call: CommandCall, site: CommandSite, word: string) => Reach
  noOperand: (call: CommandCall) => NoOperand
  /** What else its arguments make of it: a refusal, a program it runs, a file it writes. */
  also?: (call: CommandCall, site: CommandSite) => Effect[] | string | undefined
}

/** A command that reads the files it names, and perhaps does one more thing its flags decide. */
function reader(shape: ReaderShape): CommandClassifier {
  return {
    names: shape.names,
    flags: () => shape.flags ?? {},
    classify(call, site) {
      const extra = shape.also?.(call, site)
      if (typeof extra === 'string') return refused(extra)
      const supplied = shape.patternUnless !== undefined && hasFlag(call.parsed, ...shape.patternUnless)
      const files = shape.patternUnless !== undefined && !supplied ? call.parsed.operands.slice(1) : call.parsed.operands
      const fromValues = (shape.readsValueOf ?? []).map((flag) => flagValue(call.parsed, flag)).filter((v): v is string => v !== undefined)
      const named = [...files.map((word) => fileEffect('read', site, word, shape.extent(call, site, word))), ...fileEffects('read', site, fromValues, 'file')]
      const none = files.length === 0 ? shape.noOperand(call) : 'input'
      return effects(...named, ...(none === 'input' ? [] : [atCwd('read', site, none)]), ...(extra ?? []))
    },
  }
}

const file = (): Reach => 'file'
const fromInput = (): NoOperand => 'input'

/** A path that is a directory is searched down its tree; a file is read alone. */
const searched = (_call: CommandCall, site: CommandSite, word: string): Reach => {
  const place = site.place(word)
  return 'path' in place && site.exists(place.path) === 'file' ? 'file' : 'tree'
}

export const plainReaders = reader({
  names: ['cat', 'tac', 'nl', 'head', 'tail', 'wc', 'cut', 'column', 'md5sum', 'sha1sum', 'sha256sum', 'cmp', 'comm', 'stat', 'more'],
  flags: {
    short: { n: '--lines', c: '--bytes', d: '--delimiter', f: '--fields', b: '--bytes', s: '--separator', t: '--table', w: '--width' },
    valued: ['--lines', '--bytes', '--delimiter', '--fields', '--separator', '--width', '--output-delimiter', '--format'],
  },
  extent: file,
  noOperand: fromInput,
})

const GREP_FLAGS: FlagSpec = {
  short: { e: '--regexp', f: '--file', r: '--recursive', R: '--dereference-recursive', A: '--after-context', B: '--before-context', C: '--context', m: '--max-count', d: '--directories', D: '--devices', n: '--line-number', i: '--ignore-case', l: '--files-with-matches', v: '--invert-match', c: '--count', o: '--only-matching', h: '--no-filename', H: '--with-filename', E: '--extended-regexp', F: '--fixed-strings', P: '--perl-regexp', w: '--word-regexp', x: '--line-regexp', s: '--no-messages', q: '--quiet', I: '--binary-files-without-match' },
  valued: ['--regexp', '--file', '--after-context', '--before-context', '--context', '--max-count', '--directories', '--devices', '--include', '--exclude', '--exclude-dir', '--exclude-from', '--label', '--color', '--colour', '--binary-files'],
  long: ['--recursive', '--dereference-recursive', '--line-number', '--ignore-case', '--files-with-matches', '--invert-match', '--count', '--only-matching'],
}

const grepRecursive = (call: CommandCall): boolean => hasFlag(call.parsed, '--recursive', '--dereference-recursive') || flagValue(call.parsed, '--directories') === 'recurse'

export const grep = reader({
  names: ['grep', 'egrep', 'fgrep'],
  flags: GREP_FLAGS,
  patternUnless: ['--regexp', '--file'],
  readsValueOf: ['--file'],
  extent: (call, site, word) => (grepRecursive(call) ? searched(call, site, word) : 'file'),
  noOperand: (call) => (grepRecursive(call) ? 'tree' : 'input'),
})

export const ripgrep = reader({
  names: ['rg'],
  flags: {
    short: { e: '--regexp', f: '--file', g: '--glob', t: '--type', T: '--type-not', m: '--max-count', A: '--after-context', B: '--before-context', C: '--context', M: '--max-columns', j: '--threads', r: '--replace', n: '--line-number', i: '--ignore-case', l: '--files-with-matches', S: '--smart-case', F: '--fixed-strings', w: '--word-regexp', u: '--unrestricted', U: '--multiline' },
    valued: ['--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--type-add', '--max-count', '--after-context', '--before-context', '--context', '--max-columns', '--threads', '--replace', '--pre', '--pre-glob', '--sort', '--sortr', '--color', '--colors', '--encoding', '--max-depth', '--max-filesize', '--ignore-file', '--path-separator'],
  },
  patternUnless: ['--regexp', '--file'],
  readsValueOf: ['--file', '--ignore-file'],
  extent: searched,
  noOperand: () => 'tree',
  also: (call) => (hasFlag(call.parsed, '--pre') ? [{ action: 'runs', reason: 'runs a program over every file it searches' }] : undefined),
})

export const silverSearcher = reader({
  names: ['ag'],
  flags: { short: { G: '--file-search-regex', A: '--after', B: '--before', C: '--context', m: '--max-count' }, valued: ['--file-search-regex', '--after', '--before', '--context', '--max-count', '--pager', '--ignore', '--depth', '--path-to-ignore'] },
  patternUnless: [],
  extent: searched,
  noOperand: () => 'tree',
  also: (call) => (hasFlag(call.parsed, '--pager') ? [{ action: 'runs', reason: 'pipes its matches through a program' }] : undefined),
})

export const listing = reader({
  names: ['ls', 'dir'],
  flags: { short: { R: '--recursive', I: '--ignore', w: '--width', T: '--tabsize' }, valued: ['--ignore', '--width', '--tabsize', '--hide', '--format', '--sort', '--time', '--color', '--block-size', '--quoting-style', '--indicator-style', '--time-style'] },
  extent: (call, site, word) => {
    if (hasFlag(call.parsed, '--recursive')) return 'tree'
    const place = site.place(word)
    return 'path' in place && site.exists(place.path) === 'file' ? 'file' : 'directory'
  },
  noOperand: (call) => (hasFlag(call.parsed, '--recursive') ? 'tree' : 'directory'),
})

export const diskUsage = reader({
  names: ['du'],
  flags: { short: { d: '--max-depth', B: '--block-size', X: '--exclude-from', t: '--threshold' }, valued: ['--max-depth', '--block-size', '--exclude-from', '--exclude', '--threshold', '--time-style', '--files0-from'] },
  extent: () => 'tree',
  noOperand: () => 'tree',
})

export const diff = reader({
  names: ['diff'],
  flags: { short: { r: '--recursive', x: '--exclude', X: '--exclude-from', U: '--unified', C: '--context', S: '--starting-file', I: '--ignore-matching-lines', F: '--show-function-line', W: '--width' }, valued: ['--exclude', '--exclude-from', '--unified', '--context', '--starting-file', '--ignore-matching-lines', '--show-function-line', '--width', '--label', '--from-file', '--to-file', '--color', '--palette'] },
  extent: (call) => (hasFlag(call.parsed, '--recursive') ? 'tree' : 'file'),
  noOperand: fromInput,
})

export const tree = reader({
  names: ['tree'],
  flags: { short: { L: '--level', P: '--pattern', I: '--ignore', o: '--output', H: '--html', T: '--title' }, valued: ['--level', '--pattern', '--ignore', '--output', '--html', '--title', '--filelimit', '--timefmt', '--charset', '--sort'] },
  extent: () => 'tree',
  noOperand: () => 'tree',
  also: (call, site) => {
    const out = flagValue(call.parsed, '--output')
    return out === undefined ? undefined : [writeOrDestroy(site, out)]
  },
})

export const less = reader({
  names: ['less'],
  flags: { short: { o: '--log-file', O: '--LOG-FILE', b: '--buffers', h: '--max-back-scroll', j: '--jump-target', k: '--lesskey-file', p: '--pattern', P: '--prompt', t: '--tag', T: '--tag-file', x: '--tabs', y: '--max-forw-scroll', z: '--window' }, valued: ['--log-file', '--LOG-FILE', '--buffers', '--max-back-scroll', '--jump-target', '--lesskey-file', '--pattern', '--prompt', '--tag', '--tag-file', '--tabs', '--max-forw-scroll', '--window'] },
  extent: file,
  noOperand: fromInput,
  also: (call, site) => {
    if (call.args.some((a) => a.startsWith('+'))) return [{ action: 'runs', reason: 'runs a command on what it opens' }]
    const log = flagValue(call.parsed, '--log-file') ?? flagValue(call.parsed, '--LOG-FILE')
    return log === undefined ? undefined : [writeOrDestroy(site, log)]
  },
})

export const sort = reader({
  names: ['sort'],
  flags: { short: { k: '--key', t: '--field-separator', S: '--buffer-size', T: '--temporary-directory', o: '--output' }, valued: ['--key', '--field-separator', '--buffer-size', '--temporary-directory', '--output', '--compress-program', '--files0-from', '--batch-size', '--parallel', '--random-source', '--sort'] },
  extent: file,
  noOperand: fromInput,
  also: (call, site) => {
    if (hasFlag(call.parsed, '--compress-program')) return [{ action: 'runs', reason: 'pipes its output through a program of its own' }]
    const out = flagValue(call.parsed, '--output')
    return out === undefined ? undefined : [writeOrDestroy(site, out)]
  },
})

/** `uniq IN OUT` writes OUT. */
export const uniq: CommandClassifier = {
  names: ['uniq'],
  flags: () => ({ short: { f: '--skip-fields', s: '--skip-chars', w: '--check-chars' }, valued: ['--skip-fields', '--skip-chars', '--check-chars'] }),
  classify(call, site) {
    const [input, output] = call.parsed.operands
    return effects(...(input !== undefined ? [fileEffect('read', site, input, 'file')] : []), ...(output !== undefined ? [writeOrDestroy(site, output)] : []))
  },
}

export const jq = reader({
  names: ['jq'],
  flags: { short: { f: '--from-file', L: '--library-path' }, valued: ['--from-file', '--library-path', '--indent', '--arg', '--argjson'] },
  patternUnless: ['--from-file'],
  readsValueOf: ['--from-file'],
  extent: file,
  noOperand: fromInput,
})

export const yq = reader({
  names: ['yq'],
  flags: { short: { i: '--inplace', s: '--split-exp', o: '--output-format', p: '--input-format', I: '--indent' }, valued: ['--split-exp', '--output-format', '--input-format', '--indent', '--from-file', '--expression'], long: ['--inplace'] },
  patternUnless: ['--from-file', '--expression'],
  readsValueOf: ['--from-file'],
  extent: file,
  noOperand: fromInput,
  also: (call) => (hasFlag(call.parsed, '--inplace', '--split-exp') ? USE_FILE_TOOLS : undefined),
})

export const fileType = reader({
  names: ['file'],
  flags: { short: { C: '--compile', m: '--magic-file', f: '--files-from', F: '--separator', e: '--exclude', P: '--parameter' }, valued: ['--magic-file', '--files-from', '--separator', '--exclude', '--parameter'], long: ['--compile'] },
  extent: file,
  noOperand: fromInput,
  also: (call, site) => (hasFlag(call.parsed, '--compile') ? [atCwd('write', site, 'directory')] : undefined),
})

/** Printing the date only reads the clock; any operand but a `+FORMAT`, or `-s`, sets it. */
export const date: CommandClassifier = {
  names: ['date'],
  flags: () => ({ short: { d: '--date', f: '--file', r: '--reference', s: '--set', I: '--iso-8601', u: '--utc' }, valued: ['--date', '--file', '--reference', '--set'] }),
  classify(call, site) {
    const sets = hasFlag(call.parsed, '--set') || call.parsed.operands.some((o) => !o.startsWith('+'))
    return sets ? effects(reachesFromCwd('machine', site)) : effects()
  },
}

/** A name, or a file to read one from, sets the machine's hostname. */
export const hostname: CommandClassifier = {
  names: ['hostname'],
  flags: () => ({ short: { F: '--file', b: '--boot' }, valued: ['--file'] }),
  classify(call, site) {
    const sets = call.parsed.operands.length > 0 || hasFlag(call.parsed, '--file', '--boot')
    return sets ? effects(reachesFromCwd('machine', site)) : effects()
  },
}

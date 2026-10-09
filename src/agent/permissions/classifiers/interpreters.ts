import { effects, refused, USE_FILE_TOOLS } from '../effects'
import { flagValue, hasFlag } from '../flags'
import { fileEffect, reachesFromCwd, type CommandClassifier } from './classifier'

/**
 * Inline code that plainly writes a file: the model's own text put into one
 * outside the file tools. Code that does not show it is still a program of its
 * own, run with whatever it was handed.
 */
const WRITES_A_FILE = /writeFile|appendFile|createWriteStream|open\([^)]*['"][wax]\+?b?['"]|Set-Content|Out-File|Add-Content|\.write_text|\.write_bytes|File\.Write|>\s*[\w./\\-]+/

const RUNS_INLINE = 'runs a program the line itself spells out'

/** perl and ruby: `-i` edits in place, `-e` runs a program of its own, a script file runs as a command. */
export const perlAndRuby: CommandClassifier = {
  names: ['perl', 'ruby'],
  flags: () => ({ short: { e: '--eval', E: '--eval', i: '--in-place', n: '--loop', p: '--print-loop', I: '--include', M: '--module', l: '--line-end', a: '--autosplit', w: '--warnings', c: '--check', v: '--version' }, valued: ['--eval', '--include', '--module'] }),
  classify(call, site) {
    if (hasFlag(call.parsed, '--in-place') || call.args.some((a) => /^-[a-zA-Z]*i/.test(a) && !a.startsWith('-I'))) return refused(USE_FILE_TOOLS)
    if (hasFlag(call.parsed, '--version')) return effects()
    const code = flagValue(call.parsed, '--eval')
    if (code !== undefined) return WRITES_A_FILE.test(code) ? refused(USE_FILE_TOOLS) : effects({ action: 'runs', reason: RUNS_INLINE })
    return effects(reachesFromCwd('command', site))
  },
}

/** awk's program can call `system()`, pipe to a command or print to a file: every run is a program of its own, and `-i inplace` edits in place. */
export const awk: CommandClassifier = {
  names: ['awk', 'gawk', 'mawk', 'nawk'],
  classify(call) {
    const inplace = call.args.some((a, i) => (a === '-i' && call.args[i + 1] === 'inplace') || a === '-i=inplace' || a === '--include=inplace')
    return inplace ? refused(USE_FILE_TOOLS) : effects({ action: 'runs', reason: 'runs an awk program, which can start commands and write files' })
  },
}

/** python: `-c` runs code the line spells out; `-m` and a script run as a command. */
export const python: CommandClassifier = {
  names: ['python', 'python3', 'py'],
  flags: () => ({ short: { c: '--command', m: '--module', V: '--version', W: '--warnings', X: '--option' }, valued: ['--command', '--module', '--warnings', '--option'] }),
  classify(call, site) {
    if (hasFlag(call.parsed, '--version')) return effects()
    const code = flagValue(call.parsed, '--command')
    if (code !== undefined) return WRITES_A_FILE.test(code) ? refused(USE_FILE_TOOLS) : effects({ action: 'runs', reason: RUNS_INLINE })
    return effects(reachesFromCwd('command', site))
  },
}

/** node: `-e` and `-p` run code the line spells out; a script runs as a command. */
export const node: CommandClassifier = {
  names: ['node', 'deno'],
  flags: () => ({ short: { e: '--eval', p: '--print', v: '--version', r: '--require' }, valued: ['--eval', '--print', '--require', '--import', '--loader'] }),
  classify(call, site) {
    if (hasFlag(call.parsed, '--version') && call.parsed.operands.length === 0) return effects()
    const code = flagValue(call.parsed, '--eval') ?? flagValue(call.parsed, '--print')
    if (code !== undefined) return WRITES_A_FILE.test(code) ? refused(USE_FILE_TOOLS) : effects({ action: 'runs', reason: RUNS_INLINE })
    return effects(reachesFromCwd('command', site))
  },
}

/** A shell handed a command string runs whatever the string says; one handed a script runs it as a command. */
export const shells: CommandClassifier = {
  names: ['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'],
  classify(call, site) {
    const inline = call.args.some((a) => /^(-c|-Command|-EncodedCommand|\/c|\/k)$/i.test(a) || /^-[a-z]*c$/.test(a))
    if (inline) return effects({ action: 'runs', reason: 'runs a command line of its own' })
    const script = call.args.find((a) => !a.startsWith('-'))
    return script === undefined ? effects({ action: 'runs', reason: 'reads commands from its input' }) : effects(fileEffect('read', site, script, 'file'), reachesFromCwd('command', site))
  },
}

/** `eval`, `exec`, `source` and `.` run code the shell reads at the time. */
export const evaluators: CommandClassifier = {
  names: ['eval', 'exec', 'source', '.', 'trap', 'invoke-expression', 'iex'],
  classify: () => effects({ action: 'runs', reason: 'runs code it reads at the time' }),
}

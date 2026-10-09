import { effects, refused, USE_FILE_TOOLS, type Effect } from '../effects'
import { sedScriptInspects, sedScriptRuns } from '../sed-script'
import { atCwd, fileEffect, fileEffects, writeOrDestroy, type CommandClassifier } from './classifier'
import { deleting } from './file-commands'

/** `-exec`, `-execdir`, `-ok` and `-okdir` run a program over whatever find matches. */
const FIND_RUNS = new Set(['-exec', '-execdir', '-ok', '-okdir'])
/** These write the matches to the file named next. */
const FIND_WRITES = new Set(['-fprint', '-fprint0', '-fprintf', '-fls'])

/**
 * `find START... EXPRESSION`: the start paths come before the first word that
 * opens an expression, and find walks the tree below each. The expression is
 * read by hand rather than as flags, since its words are tests and actions.
 */
export const find: CommandClassifier = {
  names: ['find'],
  classify(call, site) {
    const words = call.args
    const firstExpression = words.findIndex((w) => w.startsWith('-') || w === '(' || w === '!' || w === ')')
    const starts = firstExpression === -1 ? [...words] : words.slice(0, firstExpression)
    const expression = firstExpression === -1 ? [] : words.slice(firstExpression)
    if (expression.some((w) => FIND_RUNS.has(w))) return effects({ action: 'runs', reason: 'runs a program over what it finds' })
    const action = expression.includes('-delete') ? 'destroy' : 'read'
    const walked = (starts.length ? fileEffects(action, site, starts, 'tree') : [atCwd(action, site, 'tree')]).map(deleting)
    const written: Effect[] = []
    expression.forEach((w, i) => {
      const target = expression[i + 1]
      if (FIND_WRITES.has(w) && target !== undefined) written.push(writeOrDestroy(site, target))
    })
    return effects(...walked, ...written)
  },
}

const SED_FLAGS = 'nszuEr'
const SED_LONG_FLAGS = ['--quiet', '--silent', '--separate', '--null-data', '--unbuffered', '--regexp-extended', '--follow-symlinks', '--posix', '--debug', '--sandbox']

/**
 * `sed` only reads when its whole script prints or substitutes. An in-place
 * edit, a script from a file, or one that writes with `w` is the model's own
 * text put into a file: refused, so the change goes through the file tools and
 * is shown as a diff. A script that runs a command with `e` runs a program.
 */
export const sed: CommandClassifier = {
  names: ['sed'],
  classify(call, site) {
    const args = call.args
    if (args.some((a) => a === '--help' || a === '--version')) return effects()
    const scripts: string[] = []
    const operands: string[] = []
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
        if (arg === '--expression' || arg.startsWith('--expression=')) {
          const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]
          if (value === undefined) return refused(USE_FILE_TOOLS)
          scripts.push(value)
        } else if (!SED_LONG_FLAGS.includes(arg)) return refused(USE_FILE_TOOLS)
        continue
      }
      const letters = arg.slice(1)
      const at = letters.indexOf('e')
      const before = at === -1 ? letters : letters.slice(0, at)
      // `-i`, `-f` and any flag not known to only change how sed reads its input.
      if (![...before].every((l) => SED_FLAGS.includes(l))) return refused(USE_FILE_TOOLS)
      if (at === -1) continue
      const inline = letters.slice(at + 1)
      const value = inline !== '' ? inline : args[++i]
      if (value === undefined) return refused(USE_FILE_TOOLS)
      scripts.push(value)
    }
    const script = scripts.length ? scripts : operands.slice(0, 1)
    const files = scripts.length ? operands : operands.slice(1)
    if (script.length === 0) return refused(USE_FILE_TOOLS)
    // sed joins its scripts with a newline, so a command split across two of them reads as one.
    const joined = script.join('\n')
    if (sedScriptInspects(joined)) return effects(...files.map((f) => fileEffect('read', site, f, 'file')))
    if (sedScriptRuns(joined)) return effects({ action: 'runs', reason: 'has a script that may run a command with `e`' })
    return refused(USE_FILE_TOOLS)
  },
}

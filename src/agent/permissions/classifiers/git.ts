import { effects, type Effect } from '../effects'
import { flagValue, hasFlag, type FlagSpec } from '../flags'
import { fileEffect, fileEffects, writeOrDestroy, type CommandCall, type CommandClassifier, type CommandSite } from './classifier'

/** Subcommands that only look at the repository. */
const LOOKS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'describe', 'shortlog', 'grep',
  'merge-base', 'name-rev', 'for-each-ref', 'show-ref', 'count-objects', 'whatchanged', 'check-ignore', 'var', 'help', 'version', 'rev-list', 'show-branch',
])
/** Subcommands that change the repository's history or which commit the work stands on. */
const HISTORY = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'switch', 'bisect', 'notes', 'replace', 'filter-branch', 'pull'])
/** Subcommands that reach another repository. */
const REMOTE = new Set(['fetch', 'pull', 'clone', 'ls-remote', 'push', 'submodule'])
/** Subcommands that change the working tree, the index or the repository's own files. */
const WRITES = new Set(['add', 'rm', 'mv', 'apply', 'init', 'gc', 'prune', 'repack', 'update-index', 'sparse-checkout', 'maintenance', 'lfs'])

const FLAGS: FlagSpec = {
  short: { f: '--force', D: '--delete-force', d: '--delete', n: '--dry-run', l: '--list', m: '--message', a: '--all', v: '--verbose', q: '--quiet', x: '--ignored', X: '--ignored-only', b: '--branch', B: '--force-branch', s: '--staged', W: '--worktree', u: '--set-upstream', p: '--patch', O: '--open-files-in-pager', C: '--copy', M: '--move-force', e: '--edit' },
  valued: ['--message', '--output', '--branch', '--format', '--pretty', '--author', '--since', '--until', '--source', '--file', '--git-dir', '--work-tree', '--open-files-in-pager', '--repo', '--push-option', '--set-upstream-to'],
  long: ['--force', '--force-with-lease', '--hard', '--soft', '--mixed', '--merge', '--keep', '--staged', '--worktree', '--dry-run', '--list', '--all', '--global', '--system', '--local', '--get', '--get-all', '--get-regexp', '--delete', '--unset', '--unset-all', '--replace-all', '--add', '--rename-section', '--remove-section', '--mirror', '--tags'],
}

/**
 * git: what a subcommand does to the repository it runs in, the one `-C` or
 * `--work-tree` points at or else the one the shell stands in. Looking reads
 * the repository; changing its files writes there; discarding uncommitted work
 * or rewriting pushed history destroys; changing history or reaching a remote
 * is beyond what a folder stands for.
 */
export const git: CommandClassifier = {
  names: ['git'],
  subcommands: true,
  flags: () => FLAGS,
  classify(call, site) {
    const repo = repository(call, site)
    const sub = call.subcommand
    const read = (): Effect => ({ action: 'read', place: repo, extent: 'tree' })
    const write = (): Effect => ({ action: 'write', place: repo, extent: 'tree' })
    const destroy = (): Effect => ({ action: 'destroy', place: repo, extent: 'tree' })
    const beyond = (what: 'history' | 'remote' | 'machine' | 'command'): Effect => ({ action: 'reaches', what, place: repo })
    const p = call.parsed
    if (sub === undefined) return effects(hasFlag(p, '--version') || call.args.length === 0 ? read() : beyond('command'))
    if (LOOKS.has(sub)) {
      if (sub === 'grep' && hasFlag(p, '--open-files-in-pager')) return effects({ action: 'runs', reason: 'opens the matches in a program it names' })
      const output = flagValue(p, '--output')
      return effects(read(), ...(output !== undefined ? [writeOrDestroy(site, output)] : []))
    }
    switch (sub) {
      case 'reset':
        return effects(hasFlag(p, '--hard', '--merge', '--keep') ? destroy() : beyond('history'))
      case 'clean':
        return effects(hasFlag(p, '--dry-run') ? read() : destroy())
      case 'checkout':
        // `checkout -- path`, `checkout .` and `checkout -f` throw away uncommitted changes; naming a branch moves the work.
        return effects(call.args.includes('--') || p.operands.includes('.') || hasFlag(p, '--force') ? destroy() : beyond('history'))
      case 'restore':
        return effects(hasFlag(p, '--staged') && !hasFlag(p, '--worktree') ? write() : destroy())
      case 'stash':
        return effects(stash(p.operands[0], { read, write, destroy, history: () => beyond('history') }))
      case 'branch':
        if (hasFlag(p, '--delete-force') || (hasFlag(p, '--delete') && hasFlag(p, '--force'))) return effects(destroy())
        return effects(p.operands.length === 0 && !hasFlag(p, '--delete', '--move-force', '--copy', '--set-upstream-to') ? read() : beyond('history'))
      case 'tag':
        return effects(p.operands.length === 0 || hasFlag(p, '--list') ? read() : beyond('history'))
      case 'push':
        // A forced push rewrites what others already have.
        return effects(beyond('remote'), ...(hasFlag(p, '--force', '--force-with-lease', '--mirror') || p.operands.some((o) => o.startsWith('+')) ? [destroy()] : []))
      case 'reflog':
        return effects(p.operands[0] === 'expire' || p.operands[0] === 'delete' ? destroy() : read())
      case 'remote':
        return effects(p.operands.length === 0 || ['show', 'get-url'].includes(p.operands[0]!) ? read() : write())
      case 'config':
        if (hasFlag(p, '--get', '--get-all', '--get-regexp', '--list')) return effects(read())
        return effects(hasFlag(p, '--global', '--system') ? beyond('machine') : write())
      case 'worktree':
        if (p.operands[0] === 'list') return effects(read())
        if (p.operands[0] === 'remove') return effects(destroy())
        return effects(...(p.operands[0] === 'add' && p.operands[1] !== undefined ? [fileEffect('write', site, p.operands[1], 'tree')] : []), write())
      case 'clone':
        return effects(beyond('remote'), p.operands[1] !== undefined ? fileEffect('write', site, p.operands[1], 'tree') : { action: 'write', place: site.cwd, extent: 'tree' })
    }
    if (REMOTE.has(sub)) return effects(beyond('remote'), ...(HISTORY.has(sub) ? [beyond('history')] : []))
    if (HISTORY.has(sub)) return effects(beyond('history'))
    if (WRITES.has(sub)) return effects(write(), ...(sub === 'rm' || sub === 'mv' ? fileEffects('write', site, p.operands, 'tree') : []))
    return effects(beyond('command'))
  },
}

function stash(op: string | undefined, as: { read: () => Effect; write: () => Effect; destroy: () => Effect; history: () => Effect }): Effect {
  if (op === 'list' || op === 'show') return as.read()
  if (op === 'drop' || op === 'clear') return as.destroy()
  return as.history()
}

/** The repository a git call works in: the one its own options point at, or the one the shell stands in. */
function repository(call: CommandCall, site: CommandSite): ReturnType<CommandSite['place']> {
  const before = call.before
  for (let i = 0; i < before.length; i++) {
    const word = before[i]!
    if (word === '-C' && before[i + 1] !== undefined) return site.place(before[i + 1]!)
    const named = /^--(?:git-dir|work-tree)=(.*)$/.exec(word)
    if (named) return site.place(named[1]!)
    if ((word === '--git-dir' || word === '--work-tree') && before[i + 1] !== undefined) return site.place(before[i + 1]!)
  }
  return site.cwd
}

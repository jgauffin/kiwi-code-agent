import { effects, refused, USE_FILE_TOOLS, type Effect } from '../effects'
import { flagValue, hasFlag } from '../flags'
import { fileEffect, fileEffects, writeOrDestroy, type CommandClassifier, type CommandSite } from './classifier'

/** Deleting: what it names is gone. Recursive removal reaches the tree below each operand. */
export const remove: CommandClassifier = {
  names: ['rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'shred', 'remove-item', 'ri'],
  flags: () => ({
    short: { r: '--recursive', R: '--recursive', f: '--force', i: '--interactive', v: '--verbose', d: '--dir', Recurse: '--recursive', Force: '--force', Path: '--path', LiteralPath: '--path', s: '--recursive', q: '--quiet' },
    valued: ['--path', '--interactive'],
    long: ['--recursive', '--force', '--verbose', '--dir', '--one-file-system', '--preserve-root', '--no-preserve-root'],
  }),
  classify(call, site) {
    const named = [...call.parsed.operands, ...pathFlag(call.parsed.flags.get('--path'))]
    const extent = hasFlag(call.parsed, '--recursive') || call.name === 'rmdir' || call.name === 'rd' ? 'tree' : 'file'
    return effects(...fileEffects('destroy', site, named, extent).map(deleting))
  },
}

/** Creating a directory or touching a file: a write at what it names. PowerShell's `New-Item -Value` writes text the model wrote. */
export const create: CommandClassifier = {
  names: ['mkdir', 'md', 'touch', 'new-item', 'ni'],
  flags: () => ({
    short: { p: '--parents', m: '--mode', v: '--verbose', Path: '--path', Name: '--name', ItemType: '--item-type', Value: '--value', Force: '--force', d: '--date', r: '--reference', t: '--time-stamp' },
    valued: ['--mode', '--path', '--name', '--item-type', '--value', '--date', '--reference', '--time-stamp'],
    long: ['--parents', '--verbose', '--force'],
  }),
  classify(call, site) {
    if (hasFlag(call.parsed, '--value')) return refused(USE_FILE_TOOLS)
    const named = [...call.parsed.operands, ...pathFlag(call.parsed.flags.get('--path'))]
    const reference = flagValue(call.parsed, '--reference')
    return effects(...fileEffects('write', site, named, 'file'), ...(reference !== undefined ? [fileEffect('read', site, reference, 'file')] : []))
  },
}

/** Changing a file's mode or owner changes the file: a write at what it names. */
export const attributes: CommandClassifier = {
  names: ['chmod', 'chown', 'chgrp', 'attrib'],
  flags: () => ({ short: { R: '--recursive', v: '--verbose', f: '--silent', c: '--changes' }, valued: ['--reference', '--from'], long: ['--recursive'] }),
  classify(call, site) {
    const [, ...paths] = call.parsed.operands
    return effects(...fileEffects('write', site, paths, hasFlag(call.parsed, '--recursive') ? 'tree' : 'file'))
  },
}

const TRANSFER_FLAGS = {
  short: { r: '--recursive', R: '--recursive', a: '--archive', f: '--force', i: '--interactive', n: '--no-clobber', v: '--verbose', t: '--target-directory', T: '--no-target-directory', u: '--update', p: '--preserve', l: '--link', s: '--symbolic-link', b: '--backup', S: '--suffix', Recurse: '--recursive', Force: '--force', Path: '--path', LiteralPath: '--path', Destination: '--destination', NewName: '--destination' },
  valued: ['--target-directory', '--suffix', '--path', '--destination', '--backup', '--preserve', '--reflink', '--sparse'],
  long: ['--recursive', '--archive', '--force', '--interactive', '--no-clobber', '--verbose', '--no-target-directory', '--update', '--link', '--symbolic-link'],
}

/** The sources and the destination of a copy or move, however the destination was named. */
function transferEnds(call: Parameters<CommandClassifier['classify']>[0]): { sources: string[]; destination?: string } {
  const operands = [...pathFlag(call.parsed.flags.get('--path')), ...call.parsed.operands]
  const target = flagValue(call.parsed, '--target-directory') ?? flagValue(call.parsed, '--destination')
  if (target !== undefined) return { sources: operands, destination: target }
  return operands.length < 2 ? { sources: operands } : { sources: operands.slice(0, -1), destination: operands.at(-1)! }
}

/** Landing on a file that exists replaces it. A directory receiving the files is written into. */
function landing(site: CommandSite, destination: string | undefined, sources: number, clobbers: boolean): Effect[] {
  if (destination === undefined) return []
  if (sources > 1 || !clobbers) return [fileEffect('write', site, destination, 'directory')]
  return [writeOrDestroy(site, destination)]
}

/** A copy reads its sources and writes, or replaces, its destination. */
export const copy: CommandClassifier = {
  names: ['cp', 'copy', 'copy-item', 'cpi', 'xcopy', 'robocopy'],
  flags: () => TRANSFER_FLAGS,
  classify(call, site) {
    const { sources, destination } = transferEnds(call)
    const extent = hasFlag(call.parsed, '--recursive', '--archive') ? 'tree' : 'file'
    return effects(...fileEffects('read', site, sources, extent), ...landing(site, destination, sources.length, !hasFlag(call.parsed, '--no-clobber')))
  },
}

/** A move takes its sources away from where they were, and writes, or replaces, its destination. */
export const move: CommandClassifier = {
  names: ['mv', 'move', 'move-item', 'mi', 'ren', 'rename', 'rename-item', 'rni'],
  flags: () => TRANSFER_FLAGS,
  classify(call, site) {
    const { sources, destination } = transferEnds(call)
    return effects(...fileEffects('write', site, sources, 'tree'), ...landing(site, destination, sources.length, !hasFlag(call.parsed, '--no-clobber')))
  },
}

/** A link is a new file at the path it is made at. */
export const link: CommandClassifier = {
  names: ['ln'],
  flags: () => ({ short: { s: '--symbolic', f: '--force', t: '--target-directory', n: '--no-dereference', v: '--verbose' }, valued: ['--target-directory', '--suffix'], long: ['--symbolic', '--force'] }),
  classify(call, site) {
    const operands = call.parsed.operands
    const target = flagValue(call.parsed, '--target-directory') ?? (operands.length > 1 ? operands.at(-1) : undefined)
    if (target === undefined) return effects(fileEffect('write', site, '.', 'directory'))
    return effects(hasFlag(call.parsed, '--force') ? writeOrDestroy(site, target) : fileEffect('write', site, target, 'file'))
  },
}

/**
 * `tee FILE` writes what reaches it to the files it names. What reaches it is
 * as often text the model wrote as a program's output, and the line cannot
 * tell which, so it goes through the file tools or a plain redirect.
 */
export const tee: CommandClassifier = {
  names: ['tee', 'tee-object', 'set-content', 'add-content', 'out-file', 'sc', 'ac'],
  classify(call) {
    return call.args.some((a) => !a.startsWith('-')) ? refused(USE_FILE_TOOLS) : effects()
  },
}

/** A destroy that deletes what is there. */
export function deleting(effect: Effect): Effect {
  return effect.action === 'destroy' ? { ...effect, removes: true } : effect
}

function pathFlag(value: string | true | undefined): string[] {
  return typeof value === 'string' ? value.split(',').map((p) => p.trim()).filter(Boolean) : []
}

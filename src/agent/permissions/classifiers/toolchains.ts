import { effects } from '../effects'
import { flagValue, hasFlag } from '../flags'
import { atCwd, fileEffect, reachesFromCwd, writeOrDestroy, type CommandClassifier } from './classifier'

/**
 * Package managers and toolchains. Most of what they do (build, test, run a
 * script) is the command's own business, kept as an answer for the command;
 * what is singled out here is what only reports, and what reaches a registry.
 */

const PACKAGE_REPORTS = new Set(['ls', 'list', 'view', 'info', 'outdated', 'why', 'explain', 'help', 'root', 'bin', 'prefix'])
const PACKAGE_FETCHES = new Set(['install', 'i', 'ci', 'add', 'update', 'up', 'upgrade', 'remove', 'uninstall', 'rm', 'un', 'dedupe', 'prune', 'link'])
const PACKAGE_PUBLISHES = new Set(['publish', 'unpublish', 'deprecate', 'dist-tag', 'owner', 'access'])

export const packageManagers: CommandClassifier = {
  names: ['npm', 'pnpm', 'yarn', 'bun'],
  subcommands: true,
  flags: () => ({ short: { v: '--version', g: '--global' }, long: ['--version', '--global'] }),
  classify(call, site) {
    const sub = call.subcommand
    if (sub === undefined) return effects(...(call.args.length === 0 || call.args.some((a) => a === '-v' || a === '--version') ? [] : [reachesFromCwd('command', site)]))
    if (PACKAGE_REPORTS.has(sub) || sub === '--version' || sub === '-v') return effects()
    if (sub === 'config' && ['get', 'list', 'ls'].includes(call.parsed.operands[0] ?? '')) return effects()
    if (hasFlag(call.parsed, '--global')) return effects(reachesFromCwd('machine', site))
    if (PACKAGE_FETCHES.has(sub)) return effects(reachesFromCwd('network', site))
    if (PACKAGE_PUBLISHES.has(sub)) return effects(reachesFromCwd('remote', site))
    return effects(reachesFromCwd('command', site))
  },
}

/** `npx tsc` and `npx rimraf` are different commands, so the package is what a kept answer names beside `npx`. */
export const packageRunners: CommandClassifier = {
  names: ['npx', 'pnpx', 'bunx'],
  subcommands: true,
  classify(call, site) {
    if (call.subcommand === undefined && call.args.some((a) => a === '--version' || a === '-v')) return effects()
    return effects(reachesFromCwd('command', site))
  },
}

export const dotnet: CommandClassifier = {
  names: ['dotnet'],
  subcommands: true,
  classify(call, site) {
    const sub = call.subcommand ?? call.args[0]
    if (sub === undefined || ['--version', '--info', '--list-sdks', '--list-runtimes', '-h', '--help'].includes(sub)) return effects()
    if (sub === 'nuget' && call.parsed.operands[0] === 'push') return effects(reachesFromCwd('remote', site))
    if (sub === 'restore' || (sub === 'add' && call.parsed.operands.includes('package'))) return effects(reachesFromCwd('network', site))
    return effects(reachesFromCwd('command', site))
  },
}

export const cargo: CommandClassifier = {
  names: ['cargo'],
  subcommands: true,
  classify(call, site) {
    const sub = call.subcommand ?? call.args[0]
    if (sub === undefined || sub === '--version' || sub === '-V') return effects()
    if (sub === 'metadata' || sub === 'tree') return effects(atCwd('read', site, 'tree'))
    if (sub === 'publish' || sub === 'yank' || sub === 'owner') return effects(reachesFromCwd('remote', site))
    if (sub === 'install' || sub === 'uninstall') return effects(reachesFromCwd('machine', site))
    if (sub === 'fetch' || sub === 'update' || sub === 'add') return effects(reachesFromCwd('network', site))
    return effects(reachesFromCwd('command', site))
  },
}

export const go: CommandClassifier = {
  names: ['go'],
  subcommands: true,
  classify(call, site) {
    const sub = call.subcommand
    if (sub === 'version') return effects()
    if (sub === 'env') return effects(call.args.some((a) => /^--?[wu](=|$)/.test(a)) ? reachesFromCwd('machine', site) : atCwd('read', site, 'tree'))
    if (sub === 'list') return effects(atCwd('read', site, 'tree'))
    if (sub === 'get' || sub === 'install' || (sub === 'mod' && call.parsed.operands[0] === 'download')) return effects(reachesFromCwd('network', site))
    return effects(reachesFromCwd('command', site))
  },
}

/** Fetching a URL reaches the network; where it puts what it fetched is a write there. */
export const curl: CommandClassifier = {
  names: ['curl'],
  flags: () => ({
    short: { o: '--output', O: '--remote-name', T: '--upload-file', d: '--data', F: '--form', H: '--header', X: '--request', u: '--user', A: '--user-agent', e: '--referer', b: '--cookie', c: '--cookie-jar', K: '--config', D: '--dump-header', w: '--write-out', m: '--max-time', x: '--proxy', s: '--silent', S: '--show-error', L: '--location', f: '--fail', I: '--head', k: '--insecure', v: '--verbose' },
    valued: ['--output', '--upload-file', '--data', '--data-binary', '--data-raw', '--data-urlencode', '--form', '--header', '--request', '--user', '--user-agent', '--referer', '--cookie', '--cookie-jar', '--config', '--dump-header', '--write-out', '--max-time', '--proxy', '--connect-timeout', '--retry', '--output-dir'],
  }),
  classify(call, site) {
    const p = call.parsed
    const output = flagValue(p, '--output')
    const upload = flagValue(p, '--upload-file')
    const jar = flagValue(p, '--cookie-jar')
    const config = flagValue(p, '--config')
    const sent = ['--data', '--data-binary', '--data-urlencode'].map((f) => flagValue(p, f)).filter((v): v is string => v?.startsWith('@') === true).map((v) => v.slice(1))
    return effects(
      reachesFromCwd('network', site),
      ...(output !== undefined ? [writeOrDestroy(site, output)] : []),
      ...(hasFlag(p, '--remote-name') ? [atCwd('write', site, 'directory')] : []),
      ...(jar !== undefined ? [writeOrDestroy(site, jar)] : []),
      ...[upload, config, ...sent].filter((v): v is string => v !== undefined).map((v) => fileEffect('read', site, v, 'file')),
    )
  },
}

export const wget: CommandClassifier = {
  names: ['wget'],
  flags: () => ({ short: { O: '--output-document', P: '--directory-prefix', o: '--output-file', a: '--append-output', i: '--input-file', q: '--quiet', r: '--recursive' }, valued: ['--output-document', '--directory-prefix', '--output-file', '--append-output', '--input-file'] }),
  classify(call, site) {
    const p = call.parsed
    const document = flagValue(p, '--output-document')
    const prefix = flagValue(p, '--directory-prefix')
    const written = document !== undefined ? writeOrDestroy(site, document) : prefix !== undefined ? fileEffect('write', site, prefix, 'tree') : atCwd('write', site, hasFlag(p, '--recursive') ? 'tree' : 'directory')
    return effects(reachesFromCwd('network', site), written)
  },
}

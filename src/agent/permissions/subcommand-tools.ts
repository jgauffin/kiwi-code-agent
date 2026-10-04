/**
 * Tools whose command word takes a subcommand that decides what they do, and
 * the options of their own that may stand before it. `npx tsc` and `npx rimraf`
 * are not the same permission, so the subcommand is what a rule has to name;
 * but `npx --prefix web tsc` puts two words in between, and reading past them
 * needs to know which of them takes the next word as its value.
 *
 * An option not listed here is left standing, so the rule falls back to the
 * tool itself rather than naming whichever word happens to follow: guessing
 * that `npm --loglevel warn run build` runs `warn` would write a rule that
 * covers nothing, and guessing the other way for an option that does take a
 * value would write one that covers everything.
 */
type ToolOptions = {
  /** Options that take the next word as their value. */
  valued?: readonly string[]
  /** Options that stand alone. */
  flags?: readonly string[]
}

/**
 * The options left out are the ones that make the tool run something the line
 * does not name: `npx -c` and `git -c` both hand it a string of their own.
 */
const SUBCOMMAND_TOOLS: Record<string, ToolOptions> = {
  npm: { valued: ['--prefix', '-C', '-w', '--workspace'], flags: ['-s', '--silent', '--quiet', '--workspaces', '-y', '--yes'] },
  npx: { valued: ['--prefix', '--package', '-p'], flags: ['-y', '--yes', '--no', '--no-install', '--quiet'] },
  pnpm: { valued: ['-C', '--dir', '--filter', '-F'], flags: ['-s', '--silent', '-r', '--recursive'] },
  yarn: { valued: ['--cwd'], flags: ['-s', '--silent'] },
  git: { valued: ['-C', '--git-dir', '--work-tree', '--exec-path'], flags: ['-P', '--no-pager', '--bare'] },
  dotnet: { flags: ['-d', '--diagnostics'] },
  cargo: { valued: ['--manifest-path'], flags: ['-q', '--quiet', '--offline', '--locked', '--frozen'] },
  go: { valued: ['-C'] },
  docker: { valued: ['-H', '--host', '--context', '--config'], flags: ['-D', '--debug'] },
  gh: { valued: ['-R', '--repo'] },
  az: {},
  kubectl: { valued: ['-n', '--namespace', '--context', '--kubeconfig'] },
}

/**
 * Where this tool's subcommand sits among its arguments: the number of leading
 * words that are options of the tool itself. Undefined when the command word
 * takes no subcommand, or when one of its options cannot be read.
 */
export function subcommandAt(name: string, args: string[]): number | undefined {
  const options = SUBCOMMAND_TOOLS[name]
  if (!options) return undefined
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (!arg.startsWith('-')) return i
    // `--loglevel=warn` is one word whatever the option does with its value.
    if (arg.startsWith('--') && arg.includes('=')) i += 1
    else if (options.valued?.includes(arg)) i += 2
    else if (options.flags?.includes(arg)) i += 1
    else return undefined
  }
  return i
}

/** The tool's arguments from its subcommand on, past the options that only say where to look or how to report. */
export function subcommandArguments(name: string, args: string[]): string[] {
  return args.slice(subcommandAt(name, args) ?? 0)
}

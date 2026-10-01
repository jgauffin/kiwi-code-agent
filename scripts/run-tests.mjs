// Runs Vitest with the working directory's drive letter in upper case.
//
// Started from a lower-case `d:\...` - as a shell or an editor that spells the
// path that way does - Vitest resolves itself under two spellings of the same
// path, loads itself twice, and every suite fails before its first test with
// "Vitest failed to find the runner" or "Cannot read properties of undefined
// (reading 'config')". Changing the directory from inside vitest.config.mts is
// too late: by then the double resolution has happened. So the switch is made
// here and Vitest starts as a child process that has only ever seen the upper
// case spelling.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
const vitest = join(cwd, 'node_modules', 'vitest', 'vitest.mjs')

const run = spawn(process.execPath, [vitest, 'run', ...process.argv.slice(2)], { cwd, stdio: 'inherit' })
run.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)))

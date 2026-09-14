// Makes VS Code load the extension straight from this repo. VS Code only
// loads extensions it installed itself, so: package, install the .vsix so
// it gets registered, then replace the installed folder with a junction to
// the repo. After `npm run build`, "Developer: Reload Window" picks up the
// new dist. `--unlink` uninstalls.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const id = `${pkg.publisher}.${pkg.name}`
const installed = join(homedir(), '.vscode', 'extensions', `${id}-${pkg.version}`)
const vsix = join(repo, `${pkg.name}-${pkg.version}.vsix`)
const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: true })

if (process.argv.includes('--unlink')) {
  run(`code --uninstall-extension ${id}`)
  process.exit(0)
}

if (!existsSync(vsix)) run('npm run package')
run(`code --install-extension "${vsix}"`)
rmSync(installed, { recursive: true, force: true })
symlinkSync(repo, installed, 'junction')
console.log(`\n${installed} -> ${repo}\nReload VS Code once (Developer: Reload Window).`)

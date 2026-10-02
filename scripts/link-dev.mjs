// Makes VS Code load the extension straight from this repo. VS Code only
// loads extensions it installed itself, so: package, install the .vsix so
// it gets registered, then replace the installed folder with a junction to
// the repo. After `npm run build`, "Developer: Reload Window" picks up the
// new dist. `--unlink` uninstalls.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const id = `${pkg.publisher}.${pkg.name}`
const extensions = join(homedir(), '.vscode', 'extensions')
const vsix = join(repo, 'build', `${pkg.name}-${pkg.version}.vsix`)
const run = (cmd) => execSync(cmd, { stdio: 'inherit', shell: true, cwd: repo })

if (process.argv.includes('--unlink')) {
  run(`code --uninstall-extension ${id}`)
  process.exit(0)
}

// `npm run package` emits one .vsix per platform target; a dev build needs
// neither, and an untargeted .vsix installs into a folder without a target
// suffix, which is the folder this script replaces with the junction.
if (!existsSync(vsix)) {
  mkdirSync(join(repo, 'build'), { recursive: true })
  run(`node esbuild.mjs && npx vsce package --no-dependencies --out "${vsix}"`)
}
run(`code --install-extension "${vsix}"`)

// VS Code lowercases the extension id when it names the folder.
const wanted = `${id}-${pkg.version}`.toLowerCase()
const found = readdirSync(extensions).find((e) => e.toLowerCase() === wanted)
if (!found) throw new Error(`${wanted} not found under ${extensions} after install`)
const installed = join(extensions, found)
rmSync(installed, { recursive: true, force: true })
symlinkSync(repo, installed, 'junction')
console.log(`\n${installed} -> ${repo}\nReload VS Code once (Developer: Reload Window).`)

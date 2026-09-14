// Links this repo into VS Code's extensions folder so the built extension
// loads from here. After `npm run build`, "Developer: Reload Window" picks
// up the new dist. Run once; `--unlink` removes the link.
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const linkPath = join(homedir(), '.vscode', 'extensions', `${pkg.publisher}.${pkg.name}-dev`)

if (process.argv.includes('--unlink')) {
  if (existsSync(linkPath)) rmSync(linkPath, { recursive: false, force: true })
  console.log(`removed ${linkPath}`)
  process.exit(0)
}

if (existsSync(linkPath)) {
  const stat = lstatSync(linkPath)
  if (!stat.isSymbolicLink() && !stat.isDirectory()) throw new Error(`${linkPath} exists and is not a link`)
  console.log(`already linked: ${linkPath}`)
} else {
  symlinkSync(repo, linkPath, 'junction')
  console.log(`linked ${linkPath} -> ${repo}`)
}
console.log(`If a packaged copy is installed, remove it first: code --uninstall-extension ${pkg.publisher}.${pkg.name}`)
console.log('Then reload VS Code.')

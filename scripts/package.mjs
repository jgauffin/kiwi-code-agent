// One .vsix per platform target, all of them in build/. dist/ cannot hold them:
// each target's esbuild run wipes it.
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: repo })

mkdirSync(join(repo, 'build'), { recursive: true })

for (const target of ['win32-x64', 'win32-arm64']) {
  run(`node esbuild.mjs --target=${target}`)
  run('node scripts/marketplace-readme.mjs')
  const out = join('build', `${pkg.name}-${target}-${pkg.version}.vsix`)
  run(
    `npx vsce package --no-dependencies --readme-path dist/marketplace-readme.md --target ${target} --out "${out}"`,
  )
}

// Leave dist/ as a dev build so the linked working copy keeps running.
run('node esbuild.mjs')

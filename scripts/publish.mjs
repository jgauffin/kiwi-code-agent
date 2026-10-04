// Publishes the version in package.json to the marketplace, tags the commit it was
// built from, then opens the next version so the changelog has somewhere to collect.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: repo })
const capture = (cmd) => execSync(cmd, { cwd: repo, encoding: 'utf8' }).trim()

const fail = (message) => {
  console.error(message)
  process.exit(1)
}

const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
const tag = `v${version}`

if (capture('git status --porcelain')) {
  fail('Working tree is not clean. Commit or stash everything before publishing.')
}
if (capture(`git tag --list ${tag}`)) {
  fail(`Tag ${tag} already exists, so ${version} looks published. Bump the version first.`)
}

run('npm run typecheck')

for (const target of ['win32-x64', 'win32-arm64']) {
  run(`node esbuild.mjs --target=${target}`)
  run('node scripts/marketplace-readme.mjs')
  run(
    `npx vsce publish --no-dependencies --readme-path dist/marketplace-readme.md --target ${target}`,
  )
}

run(`git tag ${tag}`)
run('git push origin HEAD')
run(`git push origin ${tag}`)

run('npm version patch --no-git-tag-version')
const next = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version

const changelogPath = join(repo, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
if (!changelog.includes(`\n## ${next}\n`)) {
  writeFileSync(
    changelogPath,
    changelog.replace(/^(# Changelog\r?\n)/, `$1\n## ${next}\n`),
    'utf8',
  )
}

// Leave dist/ as a dev build so the linked working copy keeps running.
run('node esbuild.mjs')

console.log(`\nPublished ${version} and tagged ${tag}. Now on ${next}; its changelog section is empty.`)

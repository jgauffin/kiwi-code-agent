import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const watch = process.argv.includes('--watch')
const require = createRequire(import.meta.url)

// The Agent SDK is bundled into the extension. Its cli.js (Claude Code as one
// JavaScript file) and the ripgrep it expects next to itself are copied into
// dist/ so the .vsix carries no node_modules. cli.js looks for ripgrep at
// <its own dir>/vendor/ripgrep/<arch>-<platform>/. It is ES module syntax,
// so it gets the .mjs extension outside its own package.
const sdkDir = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'))
mkdirSync('dist', { recursive: true })
cpSync(join(sdkDir, 'cli.js'), 'dist/cli.mjs')
cpSync(join(sdkDir, 'vendor', 'ripgrep', 'COPYING'), 'dist/vendor/ripgrep/COPYING')
for (const platform of ['x64-win32', 'arm64-win32']) {
  cpSync(join(sdkDir, 'vendor', 'ripgrep', platform), join('dist/vendor/ripgrep', platform), { recursive: true })
}

const extensionHost = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
}

// Split so mermaid's diagram definitions load on demand instead of sitting
// in the initial bundle; the chunks are plain ESM imports next to webview.js.
const webview = {
  entryPoints: { webview: 'src/chat/webview/main.ts' },
  outdir: 'dist',
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
}

if (watch) {
  const contexts = await Promise.all([esbuild.context(extensionHost), esbuild.context(webview)])
  await Promise.all(contexts.map((c) => c.watch()))
} else {
  await Promise.all([esbuild.build(extensionHost), esbuild.build(webview)])
}

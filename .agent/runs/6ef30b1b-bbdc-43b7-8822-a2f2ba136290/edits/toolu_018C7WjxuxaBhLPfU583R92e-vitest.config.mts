import { defineConfig } from 'vitest/config'

// Started from a lower-case drive letter (`d:\...`), Vitest loads itself twice
// and every suite fails with "Vitest failed to find the runner" or "Cannot
// read properties of undefined (reading 'config')".
const root = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
process.chdir(root)

export default defineConfig({
  root,
  // Markdown imports as its text, as esbuild's `text` loader bundles it.
  plugins: [
    {
      name: 'markdown-as-text',
      enforce: 'pre',
      transform: (code, id) => (id.endsWith('.md') ? { code: `export default ${JSON.stringify(code)}`, map: null } : undefined),
    },
  ],
  test: {
    include: ['test/**/*.test.ts'],
    // Worker threads, not child processes: one isolated worker per file (the
    // default isolation) over 120+ files means 120+ spawns, and spawning that
    // many processes on this machine intermittently starves them mid-startup,
    // failing whole files before their first test ("Cannot read properties of
    // undefined (reading 'config')", "Vitest failed to find the runner") with
    // no code at fault. Threads are cheap enough to survive it and keep the
    // per-file isolation; sharing one worker between files was tried instead
    // and leaked jsdom/module state between unrelated files.
    pool: 'threads',
  },
})

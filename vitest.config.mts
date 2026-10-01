import { defineConfig } from 'vitest/config'

// Run through `npm test`, which normalises the working directory's drive letter
// first: started from a lower-case `d:\...`, Vitest loads itself twice and every
// suite fails before its first test. Normalising it from inside this file is too
// late to help - the process has to start with it.
export default defineConfig({
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

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One worker process per file (the default) spawns 98 processes for this
    // suite; on this machine that reliably starves some of them mid-startup
    // ("Cannot read properties of undefined (reading 'config')", "Vitest
    // failed to find the runner"), failing files at random with no code
    // fault. Capping the worker count well under the core count avoids the
    // spawn storm without disabling isolation between files (isolate: false
    // shares one jsdom/module registry across every file in a worker, which
    // trades the spawn flake for cross-file state leaking into a different
    // one).
    maxWorkers: 4,
  },
})

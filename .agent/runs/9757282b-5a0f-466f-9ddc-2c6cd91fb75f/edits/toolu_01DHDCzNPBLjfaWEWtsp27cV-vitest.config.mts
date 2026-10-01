import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // One worker process per file (the default) spawns 98 processes for this
    // suite; on this machine that reliably starves some of them mid-startup
    // ("Cannot read properties of undefined (reading 'config')", "Vitest
    // failed to find the runner"), failing files at random with no code
    // fault. Reusing workers across files avoids the spawn storm, but even
    // one worker per CPU core still raced the same way under load, so pin
    // the whole run to a single worker thread: no spawn race is possible
    // with one.
    isolate: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})

import { defineConfig } from 'vitest/config'

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
    // Every file in its own fresh process, so jsdom and module state never
    // leak between files, but only a handful of processes alive at once: the
    // default spawns one per core for 116 files and on this machine that
    // starves some of them mid-startup ("Cannot read properties of undefined
    // (reading 'config')", "Vitest failed to find the runner"), failing
    // files with no code fault. (Reusing workers across files was tried
    // instead and traded this flake for jsdom state leaking between files.)
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
  },
})

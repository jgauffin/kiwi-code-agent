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
    // One worker process per file (the default) spawns 98 processes for this
    // suite; on this machine that reliably starves some of them mid-startup
    // ("Cannot read properties of undefined (reading 'config')", "Vitest
    // failed to find the runner"), failing files at random with no code
    // fault. Reusing workers across files avoids the spawn storm. (Forcing
    // it down to a single worker, or dropping isolation further, was tried
    // and traded this flake for a worse one: jsdom/module state leaking
    // between unrelated test files.)
    isolate: false,
  },
})

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
    // Each file gets its own isolated worker (the default). Sharing a worker
    // between files was tried here to avoid a spawn storm, but on vitest 5.0.3
    // it makes every file fail before its first test ("Cannot read properties
    // of undefined (reading 'config')", "Vitest failed to find the runner"),
    // and it leaked jsdom/module state between unrelated files besides.
  },
})

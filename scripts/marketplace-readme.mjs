// Writes the Marketplace README: ReadMe.md without its <!-- github-only --> blocks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('ReadMe.md', 'utf8');
const stripped = source.replace(/<!-- github-only -->[\s\S]*?<!-- \/github-only -->(\r?\n){0,2}/g, '');
if (stripped === source) {
  throw new Error('ReadMe.md has no <!-- github-only --> block; the Marketplace README would be identical.');
}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/marketplace-readme.md', stripped);

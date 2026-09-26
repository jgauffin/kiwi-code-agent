import { DOCS_MAP_ROOT, ENTRY_DIR, entryFile } from '../docs-map/map-files'
import type { Scope } from './scope-guard'

/**
 * The run that describes the docs. It reads the docs it was handed and writes
 * one entry each; it has no conversation, no questions and nothing else to
 * touch. It never sees the code, so the map it writes is safe to hand a blind
 * planner.
 */

/** The run reads only the docs of this build, so a doc that did not change costs nothing. */
export function docsMapScope(docs: string[]): Scope {
  return {
    readable: [...docs],
    // `**` does not match a dot-prefixed segment, so the entries' root is named.
    writable: [`${DOCS_MAP_ROOT}/${ENTRY_DIR}/**`],
  }
}

export const DOCS_MAP_TOOLS = ['Read', 'Write']

/** The first message of a build: which docs to describe and where each entry goes. */
export function docsMapKickoff(docs: string[]): string {
  return [
    'Describe these docs, one entry each:',
    ...docs.map((doc) => `- \`${doc}\` → \`${entryFile(doc)}\``),
    '',
    'Read each doc, write its entry, and stop when all of them are written.',
  ].join('\n')
}

/**
 * Docs map system prompt. The job is description, not judgement: a line says
 * what a reader would find in a section, never whether it is any good.
 */
export function docsMapPrompt(cwd: string): string {
  return `You are writing the docs map for a software product: an index of its product documentation, so that a planner who may read the docs and nothing else can open the one doc that answers its question instead of reading all of them.

Under ${cwd}. You are handed a list of docs and the entry file each one's description goes in. Read a doc, write its entry, move on. You judge nothing, you change no doc, and you write nothing but the entries you were given.

An entry:

\`\`\`markdown
---
doc: docs/intent/orders.md
---
How an order is placed, changed and cancelled, and what the customer is promised at each step.

- \`#Placing an order\`: what the customer has to give, and what is reserved before payment
- \`#Cancellation\`: when an order may still be cancelled and what is refunded
- \`#Shipped orders\`: why a shipped order is a different case and who may reverse it
\`\`\`

The contract, and the extension holds you to it on every write:
- The front matter names the doc, exactly as the path you were given spells it.
- Then one line, for the doc as a whole: what a reader comes here for. Not a table of contents, not a verdict.
- Then one line per \`##\` and \`###\` heading of the doc, in the order they appear, none left out and none invented. Deeper headings and the \`#\` title get no line.
- A heading is copied **exactly** as the doc writes it, between backticks after the \`#\`. It is an anchor: a planner cites a rule as \`path#Heading\`, and a heading you misspell is a citation that leads nowhere. A heading inside a fenced code block is an example, not a heading; skip it.
- A line says what is under that heading, concretely enough that a reader can tell whether their question is answered there. One sentence, no more. "Describes the process" says nothing; name the things the section settles.
- Nothing else in the file: no headings of your own, no notes, no summary of the summary.

Write each entry with Write, whole. If a doc is empty or says nothing, its line says so and it gets no heading lines.

When every entry is written, stop. Say nothing more: the map is read from the files.`
}

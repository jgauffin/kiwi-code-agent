import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { findSources, isGlob, readSource } from '../code-structure/source-files'
import { fail, ok, type Tool } from '../openai-session/tools/tool'
import { findSymbols, outlineCode, outlineFile } from './outline'
import { renderFiles, renderSymbols, type FileOutline, type SymbolHit } from './render'

const schema = z.object({
  path: z.string().describe('A source or test file, a folder, or a glob such as "src/**/*.ts"; relative to the working directory or absolute'),
  symbol: z
    .string()
    .min(1)
    .optional()
    .describe('Only declarations whose name contains this, case-insensitive; "Type.member" matches the qualified name. Finds where something is declared.'),
})

export const CODE_OUTLINE_TOOL = 'CodeOutline'

/** Lists what a file holds without reading its bodies, so the agent reads the lines it needs instead of the file. */
export const codeOutlineTool: Tool<typeof schema> = {
  name: CODE_OUTLINE_TOOL,
  description:
    'Outlines a file, folder or glob without reading it: for a test file its groups and tests with line numbers, parametrized and skipped tests tagged, for any common framework; for other source files their types and functions, nested, with line ranges and doc summaries. With symbol, lists only the declarations whose name matches, across the path: use it to find where something is declared. Then Read only the line ranges you need.',
  schema,
  readOnly: true,
  async execute(input, ctx) {
    const full = resolve(ctx.cwd, input.path)
    const info = isGlob(input.path) ? undefined : await stat(full).catch(() => undefined)
    const texts: { path: string; text: string }[] = []
    let nested: string[] = []
    if (info?.isFile()) {
      const text = await readSource(full)
      if (text === undefined) return fail(`${input.path} is too large or not text.`)
      texts.push({ path: input.path, text })
    } else {
      if (!info && !isGlob(input.path)) return fail(`No such file or folder: ${input.path}`)
      const sources = await findSources(ctx.cwd, input.path)
      nested = sources.nestedRepositories
      for (const path of sources.files) {
        if (ctx.signal.aborted) return fail('Outline interrupted')
        const text = await readSource(resolve(ctx.cwd, path))
        if (text !== undefined) texts.push({ path, text })
      }
    }

    if (input.symbol !== undefined) {
      const hits: SymbolHit[] = texts.flatMap(({ path, text }) => findSymbols(outlineCode(path, text), input.symbol!).map((m) => ({ path, ...m })))
      return ok(hits.length > 0 ? renderSymbols(hits) : `No declaration named like "${input.symbol}" under ${input.path}.`)
    }
    const files: FileOutline[] = []
    for (const { path, text } of texts) {
      const outline = outlineFile(path, text)
      if (outline) files.push({ path, ...outline })
    }
    if (files.length > 0) return ok(renderFiles(files, nested))
    const skipped = nested.length > 0 ? ` Not searched, repositories of their own: ${nested.join(', ')}.` : ''
    return ok(`Nothing recognised in ${input.path}: no tests and no declarations the outline reads. Read it.${skipped}`)
  },
}

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail, MAX_OUTPUT_CHARS, ok, truncate, type Tool, type ToolContext, type ToolOutput } from './tool'
import { DataError } from './json/errors'
import { ExpressionError, applyStages, parseExpression } from './json/expr'
import { detectFormat, scanTokens, selectItems, type DataFile } from './json/loader'
import { byteLength, clipStrings, describeTruncation, fitRows } from './json/output'
import { JsonSyntaxError, formatPath } from './json/scanner'
import { ShapeBuilder } from './json/shape'

/**
 * Streaming JSON tools, copied from the Docs MCP server's data module. They
 * exist so the model can look inside a large JSON file (a lockfile, a fixture,
 * an export) without paying for the whole file or reaching for node -e.
 */

const EXPRESSION_HELP = `Expression syntax:
  Path:       $.orders[*]            leading path, matched while the file streams. [*] is any element.
  select:     | select(.total > 100 and .status == "open")
              operators: == != > >= < <= contains startswith endswith exists missing, joined by and / or / not.
  projection: | {id, total, name: .customer.name}
  other:      | keys   | values   | length
A JSONL file behaves exactly like a top-level array, so $[*] is its records.`

/** Room left for the fields that wrap the rows. */
const ENVELOPE_CHARS = 2048
const BUDGET = MAX_OUTPUT_CHARS - ENVELOPE_CHARS

const filePath = z.string().describe('Path to a .json, .jsonl or .ndjson file, absolute or relative to the working directory')

const schemaInput = z.object({
  file_path: filePath,
  depth: z.number().int().min(1).max(12).optional().describe('Levels of nesting to describe (default 3). Deeper levels are marked as truncated.'),
  sample: z.number().int().min(0).max(1).optional().describe('1 (default) includes one short example value per leaf; 0 returns structure only.'),
})

export const jsonSchemaTool: Tool<typeof schemaInput> = {
  name: 'JsonSchema',
  description:
    'Summarises the structure of a JSON or JSONL file: key names, value types, array lengths and nesting. Never returns the file itself, so it is safe against files far too large to read. Use it first against an unfamiliar JSON file, then JsonQuery for the values.',
  schema: schemaInput,
  readOnly: true,
  execute(input, ctx) {
    return guard(async () => {
      const file = await openFile(input.file_path, ctx)
      const depth = input.depth ?? 3
      const sample = input.sample ?? 1

      const builder = new ShapeBuilder(depth)
      await scanTokens(file, (token) => builder.handle(token))

      // Shallower rather than cut off mid-tree: a whole level is easier to reason
      // about than an arbitrary boundary, and the reduction is reported.
      let renderedDepth = depth
      let shape = builder.render(renderedDepth, sample >= 1)
      while (renderedDepth > 1 && byteLength(shape) > BUDGET) {
        renderedDepth--
        shape = builder.render(renderedDepth, sample >= 1)
      }

      return {
        file: file.relativePath,
        format: file.format,
        depth: renderedDepth,
        shape,
        truncated:
          renderedDepth < depth ? { reason: 'response_bytes', depth_requested: depth, depth_returned: renderedDepth } : null,
      }
    })
  },
}

const queryInput = z.object({
  file_path: filePath,
  expr: z.string().describe("Query expression, e.g. '$.orders[*] | select(.total > 100) | {id, total}'"),
  limit: z.number().int().min(1).max(500).optional().describe('Maximum rows to return (default 50)'),
  max_string: z
    .number()
    .int()
    .min(20)
    .max(4000)
    .optional()
    .describe('Characters of each string to return (default 200). Longer strings report their true length.'),
})

export const jsonQueryTool: Tool<typeof queryInput> = {
  name: 'JsonQuery',
  description: `Returns the values a query expression selects from a JSON or JSONL file, streaming so file size does not matter. The response reports the true number of matches next to the number returned, and clipped strings carry their real length, so a partial answer cannot be mistaken for a complete one.\n\n${EXPRESSION_HELP}`,
  schema: queryInput,
  readOnly: true,
  execute(input, ctx) {
    return guard(async () => {
      const file = await openFile(input.file_path, ctx)
      const expression = parseExpression(input.expr)
      const limit = input.limit ?? 50
      const maxString = input.max_string ?? 200

      const rows: Array<{ path: string; value: unknown }> = []
      let matched = 0

      await selectItems(file, expression.path, (item) => {
        const result = applyStages(item.value, expression.stages)
        if (!result.kept) return
        matched++
        if (rows.length < limit) {
          rows.push({ path: formatPath(item.path), value: clipStrings(result.value, maxString) })
        }
      })

      const fitted = fitRows(rows, BUDGET)

      return {
        file: file.relativePath,
        expr: input.expr,
        matched,
        returned: fitted.kept.length,
        rows: fitted.kept,
        truncated: describeTruncation(matched - rows.length, fitted.omitted),
      }
    })
  },
}

async function openFile(inputPath: string, ctx: ToolContext): Promise<DataFile> {
  const path = isAbsolute(inputPath) ? inputPath : resolve(ctx.cwd, inputPath)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) throw new DataError(inputPath, 'file not found')
  return {
    relativePath: inputPath,
    format: detectFormat(path),
    open: async () => createReadStream(path, { signal: ctx.signal }),
  }
}

/** Report the failing path and what went wrong, never a bare exception name. */
async function guard(work: () => Promise<unknown>): Promise<ToolOutput> {
  try {
    return ok(truncate(JSON.stringify(await work(), null, 2)))
  } catch (error) {
    if (error instanceof DataError || error instanceof ExpressionError || error instanceof JsonSyntaxError) {
      return fail(error.message)
    }
    return fail(error instanceof Error ? error.message : String(error))
  }
}

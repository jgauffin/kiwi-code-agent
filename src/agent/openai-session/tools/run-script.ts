import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { fileEditChange, type FileEditChange } from '../../edits/file-edit-diff'
import { unifiedDiff } from '../../edits/unified-diff'
import { DEFAULT_SANDBOX_OPTIONS, runSandboxed, type HostCall } from '../../script/sandbox'
import { fail, ok, truncate, type Tool, type ToolContext } from './tool'

const schema = z.object({
  script: z.string().describe('The body of an async JavaScript function. `await` and `return` work at the top level.'),
})

/** The script's function for each tool it may use; the arguments are the tool's own, as one object. */
const TOOL_FUNCTIONS: Record<string, string> = {
  glob: 'Glob',
  grep: 'Grep',
  bash: 'Bash',
  jsonQuery: 'JsonQuery',
  jsonSchema: 'JsonSchema',
}

const HOST_FUNCTIONS = ['read', 'write', 'edit', 'preview', ...Object.keys(TOOL_FUNCTIONS)]

/**
 * `replace` is written in the guest so its regular expression runs inside the
 * interpreter, under the script's time budget, not on the host where a
 * runaway pattern could not be stopped.
 */
const PRELUDE = `
globalThis.replace = async (path, pattern, replacement, flags = 'g') => {
  const before = await read(path);
  const counter = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const matches = [...before.matchAll(counter)].length;
  const after = before.replace(new RegExp(pattern, flags), replacement);
  if (after !== before) await write(path, after);
  return { path, matches, changed: after !== before };
};
`

type Staged = { before: string; after: string }

/**
 * Runs a script in an embedded interpreter that can reach nothing but the
 * functions below. Reads and other tools go through the same permission gate
 * the model's own calls do. Changes to files are staged, never written as the
 * script runs: when it ends, the user decides on all of them at once.
 */
export function runScriptTool(): Tool<typeof schema> {
  return {
    name: 'RunScript',
    description:
      'Runs a JavaScript program that reads and analyses files or command output, or edits many files, in one step. It returns only what the program returns or logs, and edits are shown to the user together and applied only once approved. Before writing a script, call the Skill tool with name "run-script": it lists the functions available and gives examples.',
    schema,
    // A script can do nothing on its own; every call it makes is gated when made.
    readOnly: true,
    async execute(input, ctx) {
      if (!ctx.call || !ctx.authorize) return fail('RunScript is not available in this session')
      const lines: string[] = []
      const staged = new Map<string, Staged>()
      const result = await runSandboxed(
        input.script,
        HOST_FUNCTIONS,
        hostFor(ctx, staged),
        { signal: ctx.signal, ...DEFAULT_SANDBOX_OPTIONS, prelude: PRELUDE },
        (line) => lines.push(line),
      )
      if (!result.ok) return fail(truncate([...lines, `Script failed: ${result.error}`].join('\n')))
      const value = result.value === null || result.value === undefined ? [] : [typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2)]
      const outcome = await applyStaged(ctx, staged)
      const text = [...lines, ...value, ...(outcome.text ? [outcome.text] : [])].join('\n') || 'Script finished without output.'
      return outcome.isError ? fail(truncate(text)) : ok(truncate(text))
    },
  }
}

function hostFor(ctx: ToolContext, staged: Map<string, Staged>): HostCall {
  return async (name, args) => {
    const [first, second] = args as unknown[]
    switch (name) {
      case 'read':
        return currentContent(ctx, staged, pathArg(first, 'read'))
      case 'write':
        return stage(ctx, staged, pathArg(first, 'write'), textArg(second, 'write(path, content)'))
      case 'edit':
        return edit(ctx, staged, first as EditArgs)
      case 'preview':
        return preview(ctx, staged)
    }
    const tool = TOOL_FUNCTIONS[name]
    if (!tool) throw new Error(`Unknown function: ${name}`)
    const output = await ctx.call!(tool, first ?? {})
    if (output.isError) throw new Error(output.text)
    return output.text
  }
}

const absolute = (ctx: ToolContext, path: string) => (isAbsolute(path) ? path : resolve(ctx.cwd, path))

function pathArg(value: unknown, fn: string): string {
  if (typeof value !== 'string') throw new Error(`${fn}(path) takes the path of a file`)
  return value
}

function textArg(value: unknown, usage: string): string {
  if (typeof value !== 'string') throw new Error(`${usage} takes text`)
  return value
}

async function refuse(ctx: ToolContext, tool: string, input: unknown): Promise<void> {
  const refused = await ctx.authorize!(tool, input)
  if (refused) throw new Error(refused)
}

/** The file as the script has left it so far: its own staged version when it has one, else what is on disk (empty for a file that does not exist yet). */
async function currentContent(ctx: ToolContext, staged: Map<string, Staged>, path: string, mustExist = true): Promise<string> {
  await refuse(ctx, 'Read', { file_path: path })
  const full = absolute(ctx, path)
  const held = staged.get(full)
  if (held) return held.after
  try {
    return await readFile(full, 'utf8')
  } catch (error) {
    if (!mustExist && (error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function stage(ctx: ToolContext, staged: Map<string, Staged>, path: string, content: string): Promise<null> {
  await refuse(ctx, 'Write', { file_path: path, content })
  const full = absolute(ctx, path)
  const before = staged.get(full)?.before ?? (await currentContent(ctx, new Map(), path, false))
  staged.set(full, { before, after: content })
  return null
}

type EditArgs = { file_path?: unknown; old_string?: unknown; new_string?: unknown; replace_all?: unknown }

async function edit(ctx: ToolContext, staged: Map<string, Staged>, args: EditArgs): Promise<null> {
  const path = pathArg(args?.file_path, 'edit')
  const oldText = textArg(args.old_string, 'edit({ old_string })')
  const newText = textArg(args.new_string, 'edit({ new_string })')
  await refuse(ctx, 'Edit', { file_path: path, old_string: oldText, new_string: newText })
  const content = await currentContent(ctx, staged, path)
  const occurrences = oldText === '' ? 0 : content.split(oldText).length - 1
  if (occurrences === 0) throw new Error(`old_string not found in ${path}`)
  if (occurrences > 1 && !args.replace_all) throw new Error(`old_string occurs ${occurrences} times in ${path}; add more context or set replace_all`)
  const updated = args.replace_all ? content.split(oldText).join(newText) : content.replace(oldText, () => newText)
  return stage(ctx, staged, path, updated)
}

const changed = (staged: Map<string, Staged>) => [...staged].filter(([, s]) => s.before !== s.after)

function preview(ctx: ToolContext, staged: Map<string, Staged>): string {
  const files = changed(staged)
  if (files.length === 0) return 'No changes staged.'
  return files.map(([path, s]) => [`--- ${label(ctx, path)}`, ...unifiedDiff(s.before, s.after, 3)].join('\n')).join('\n\n')
}

const label = (ctx: ToolContext, path: string) => {
  const rel = relative(ctx.cwd, path).split('\\').join('/')
  return rel && !rel.startsWith('..') ? rel : path
}

async function applyStaged(ctx: ToolContext, staged: Map<string, Staged>): Promise<{ text: string; isError: boolean }> {
  const files = changed(staged)
  if (files.length === 0) return { text: '', isError: false }
  if (!ctx.review) return { text: 'The script staged changes, but this session cannot put them to the user; nothing was written.', isError: true }
  const edits: FileEditChange[] = files.map(([path, s]) => fileEditChange({ path, label: label(ctx, path), states: [s.before, s.after] }))
  const title = `Apply changes to ${files.length} file${files.length === 1 ? '' : 's'}`
  if (!(await ctx.review(title, edits))) return { text: 'The user declined the changes; nothing was written.', isError: true }
  for (const [path, s] of files) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, s.after, 'utf8')
    await ctx.files.markRead(path)
  }
  return { text: `Applied changes to ${files.length} file${files.length === 1 ? '' : 's'}: ${files.map(([p]) => label(ctx, p)).join(', ')}`, isError: false }
}

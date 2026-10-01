import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { CODE_SEARCH_TOOL } from '../../code-outline/code-search'
import { fileEditChange, type FileEditChange } from '../../edits/file-edit-diff'
import { unifiedDiff } from '../../edits/unified-diff'
import { DEFAULT_SANDBOX_OPTIONS, runSandboxed, type HostCall } from '../../script/sandbox'
import { MARKDOWN_SEARCH_TOOL } from './markdown-search'
import { fail, ok, truncate, type Tool, type ToolContext } from './tool'

const schema = z.object({
  script: z.string().describe('The body of an async JavaScript function. `await` and `return` work at the top level.'),
})

/**
 * The script's function for each tool it may use; the arguments are the tool's own, as one object.
 * A tool is here when it answers with data a program can use and changes nothing: what a script
 * changes goes through the staged functions below, so the user judges it as one diff. AskUser,
 * Skill and the task board are left out because their answers are for the model, not a loop.
 * Bash is left out because a loop of commands is a loop of permission prompts.
 */
const TOOL_FUNCTIONS: Record<string, string> = {
  glob: 'Glob',
  grep: 'Grep',
  codeSearch: CODE_SEARCH_TOOL,
  markdownSearch: MARKDOWN_SEARCH_TOOL,
  codeOutline: 'CodeOutline',
  jsonQuery: 'JsonQuery',
  jsonSchema: 'JsonSchema',
}

const HOST_FUNCTIONS = ['read', 'readdir', 'exists', 'write', 'edit', 'move', 'copy', 'remove', 'preview', ...Object.keys(TOOL_FUNCTIONS)]

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

/** A file as the script leaves it: `after` is null once removed; `existed` says whether it was on disk before. */
type Staged = { before: string; after: string | null; existed: boolean }

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
      'Runs a JavaScript program (the body of an async function) that reads and analyses files, or changes many files, in one step: the tool for the same change across files, for reading many files to answer one question, and for what you would otherwise write in python, node or powershell through the shell. Its functions: read(path), readdir(path), exists(path); staged changes write(path, content), edit({ file_path, old_string, new_string, replace_all }), replace(path, regex, replacement, flags), move(source, destination), copy(source, destination), remove(path), preview(); and the tools glob({ pattern, path }), grep({ pattern, path, include, output_mode }), codeSearch({ query, path, regex }), markdownSearch({ query, path, regex }), codeOutline({ path, symbol }), jsonQuery(args), jsonSchema(args). glob, grep, codeSearch and markdownSearch return arrays with every match. String, RegExp, JSON and the rest of plain JavaScript work; shell commands, Node modules and the network do not. It returns only what the program returns or logs, and changes are shown to the user together and applied only once approved. The run-script skill has the details and examples.',
    schema,
    // A script can do nothing on its own; every call it makes is gated when made.
    readOnly: true,
    async execute(input, ctx) {
      if (!ctx.call || !ctx.authorize || !ctx.confirm) return fail('RunScript is not available in this session')
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
      case 'readdir':
        return listDirectory(ctx, first === undefined ? '.' : pathArg(first, 'readdir'))
      case 'exists':
        return pathExists(ctx, staged, pathArg(first, 'exists'))
      case 'write':
        return stage(ctx, staged, pathArg(first, 'write'), textArg(second, 'write(path, content)'))
      case 'edit':
        return edit(ctx, staged, first as EditArgs)
      case 'move':
      case 'copy':
        return transfer(ctx, staged, name, pathArg(first, name), pathArg(second, `${name}(source, destination)`))
      case 'remove':
        return remove(ctx, staged, pathArg(first, 'remove'))
      case 'preview':
        return preview(ctx, staged)
    }
    const tool = TOOL_FUNCTIONS[name]
    if (!tool) throw new Error(`Unknown function: ${name}`)
    const output = await ctx.call!(tool, first ?? {})
    if (output.isError) throw new Error(output.text)
    return output.items ?? output.text
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

/**
 * Looking about the file system rather than at one known file. Inside the
 * project the gate lets it through; outside it the user is asked, so a script
 * cannot wander the disk on its own.
 */
async function look(ctx: ToolContext, tool: string, path: string): Promise<void> {
  const refused = await ctx.confirm!(tool, { path })
  if (refused) throw new Error(refused)
}

/** The names in a directory, sorted, each directory marked by a trailing slash. */
async function listDirectory(ctx: ToolContext, path: string): Promise<string[]> {
  await look(ctx, 'ReadDir', path)
  const entries = await readdir(absolute(ctx, path), { withFileTypes: true })
  return entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort()
}

/** A file the script has staged counts as there, and one it has removed as gone, as `read` already treats them. */
async function pathExists(ctx: ToolContext, staged: Map<string, Staged>, path: string): Promise<boolean> {
  await look(ctx, 'Exists', path)
  return present(staged, absolute(ctx, path))
}

async function present(staged: Map<string, Staged>, full: string): Promise<boolean> {
  const held = staged.get(full)
  if (held) return held.after !== null
  try {
    await stat(full)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** What is on disk, or null for a file that does not exist. */
async function onDisk(full: string): Promise<string | null> {
  try {
    return await readFile(full, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** The file as the script has left it so far: its own staged version when it has one, else what is on disk. */
async function currentContent(ctx: ToolContext, staged: Map<string, Staged>, path: string): Promise<string> {
  await refuse(ctx, 'Read', { file_path: path })
  const full = absolute(ctx, path)
  const held = staged.get(full)
  if (held && held.after === null) throw new Error(`${path} does not exist: the script removed it`)
  if (held) return held.after!
  return readFile(full, 'utf8')
}

async function stage(ctx: ToolContext, staged: Map<string, Staged>, path: string, content: string): Promise<null> {
  await refuse(ctx, 'Write', { file_path: path, content })
  const full = absolute(ctx, path)
  const held = staged.get(full)
  if (held) held.after = content
  else {
    const before = await onDisk(full)
    staged.set(full, { before: before ?? '', after: content, existed: before !== null })
  }
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

/**
 * A move is staged as the destination created and the source removed, so it
 * joins the one diff. Text files only: a folder or a binary file goes through
 * the Move or Copy tool, which works on the disk directly.
 */
async function transfer(ctx: ToolContext, staged: Map<string, Staged>, kind: 'move' | 'copy', source: string, destination: string): Promise<null> {
  await refuse(ctx, kind === 'move' ? 'Move' : 'Copy', { source, destination })
  const full = absolute(ctx, source)
  if (!staged.has(full) && (await stat(full).catch(() => undefined))?.isDirectory())
    throw new Error(`${kind} takes a file, and ${source} is a folder: glob its files and ${kind} each, or use the ${kind === 'move' ? 'Move' : 'Copy'} tool`)
  const content = await currentContent(ctx, staged, source)
  if (content.includes('\u0000')) throw new Error(`${source} is not a text file: use the ${kind === 'move' ? 'Move' : 'Copy'} tool`)
  if (await present(staged, absolute(ctx, destination))) throw new Error(`Destination already exists: ${destination}`)
  await stage(ctx, staged, destination, content)
  if (kind === 'move') await remove(ctx, staged, source)
  return null
}

async function remove(ctx: ToolContext, staged: Map<string, Staged>, path: string): Promise<null> {
  await refuse(ctx, 'Write', { file_path: path, content: '' })
  const full = absolute(ctx, path)
  const held = staged.get(full)
  if (held?.after === null) throw new Error(`${path} does not exist: the script removed it`)
  if (held) held.after = null
  else {
    const before = await onDisk(full)
    if (before === null) throw new Error(`Not found: ${path}`)
    staged.set(full, { before, after: null, existed: true })
  }
  return null
}

/** A file created and removed again within the script never reaches the user. */
const changed = (staged: Map<string, Staged>) =>
  [...staged].filter(([, s]) => (s.after === null ? s.existed : !s.existed || s.before !== s.after))

function preview(ctx: ToolContext, staged: Map<string, Staged>): string {
  const files = changed(staged)
  if (files.length === 0) return 'No changes staged.'
  return files
    .map(([path, s]) => (s.after === null ? `--- ${label(ctx, path)} (removed)` : [`--- ${label(ctx, path)}`, ...unifiedDiff(s.before, s.after, 3)].join('\n')))
    .join('\n\n')
}

const label = (ctx: ToolContext, path: string) => {
  const rel = relative(ctx.cwd, path).split('\\').join('/')
  return rel && !rel.startsWith('..') ? rel : path
}

async function applyStaged(ctx: ToolContext, staged: Map<string, Staged>): Promise<{ text: string; isError: boolean }> {
  const files = changed(staged)
  if (files.length === 0) return { text: '', isError: false }
  if (!ctx.review) return { text: 'The script staged changes, but this session cannot put them to the user; nothing was written.', isError: true }
  const edits: FileEditChange[] = files.map(([path, s]) =>
    s.after === null
      ? fileEditChange({ path, label: label(ctx, path), unreadable: 'removed' })
      : fileEditChange({ path, label: label(ctx, path), states: [s.before, s.after] }),
  )
  const title = `Apply changes to ${files.length} file${files.length === 1 ? '' : 's'}`
  const decision = await ctx.review(title, edits)
  if (decision.kind === 'deny') return { text: `The user declined the changes${decision.message ? `: ${decision.message}` : ''}; nothing was written.`, isError: true }
  for (const [path, s] of files) {
    if (s.after === null) {
      await rm(path)
      ctx.files.forget(path)
      ctx.ledger?.forget(path)
      continue
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, s.after, 'utf8')
    await ctx.files.markRead(path)
    ctx.ledger?.written(path)
  }
  return { text: `Applied changes to ${files.length} file${files.length === 1 ? '' : 's'}: ${files.map(([p]) => label(ctx, p)).join(', ')}`, isError: false }
}

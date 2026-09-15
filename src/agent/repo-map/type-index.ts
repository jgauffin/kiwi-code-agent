import { extname } from 'node:path'
import { languageOf } from '../cleanup/language'
import { stripLiterals } from '../cleanup/strip-literals'
import { byPath } from './map-files'

/**
 * A project's public surface, read out of its source by the build itself: no
 * language service, no compiler, the same brace-and-literal reading the size
 * measure uses. C# calls it `public`, TypeScript calls it `export`; both come
 * out as one line per type and one line per member.
 *
 * A file the scan cannot make sense of — unbalanced braces once the literals
 * are out, binary content, a language this does not read — is left out and
 * named as skipped instead of failing the build.
 */

export type PublicType = {
  /** Workspace-relative path of the file the type is declared in. */
  file: string
  /** 1-based line of the declaration. */
  line: number
  name: string
  /** The declaration as written, comments and literals out, on one line. */
  signature: string
  /** Public members, one line each, in declaration order. */
  members: string[]
}

export type TypeIndex = {
  types: PublicType[]
  /** Files the scan could not read, sorted; named in the index so their absence is visible. */
  skipped: string[]
}

export type SourceFile = { path: string; text: string }

/**
 * The public declarations of one file, or undefined when the scan cannot read
 * it — which is the caller's cue to name it skipped.
 */
export function scanPublicTypes(path: string, text: string): PublicType[] | undefined {
  const lang = languageOf(path)
  if (!lang || lang.family !== 'brace') return undefined
  if (text.includes('\u0000')) return undefined
  try {
    return scan(path, text, extname(path).toLowerCase() === '.cs')
  } catch {
    return undefined
  }
}

/** One open declaration: the type whose body the scan is inside. */
type Open = { type: PublicType; depth: number; opened: boolean }

function scan(path: string, text: string, csharp: boolean): PublicType[] | undefined {
  const lang = languageOf(path)!
  const lines = stripLiterals(text, lang).split(/\r?\n/)
  const types: PublicType[] = []
  const stack: Open[] = []
  let depth = 0
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    const code = line.trim()
    const enclosing = stack[stack.length - 1]
    const declared = csharp ? csharpDeclaration(code) : typescriptDeclaration(code)
    if (declared?.kind === 'type') {
      const type: PublicType = { file: path, line: n + 1, name: declared.name, signature: declared.signature, members: [] }
      types.push(type)
      // A body that opens on the declaration's own line — `public enum Kind { A, B }` — is open from here.
      stack.push({ type, depth, opened: line.includes('{') })
    } else if (declared?.kind === 'member' && enclosing && depth === enclosing.depth + 1) {
      enclosing.type.members.push(declared.signature)
    }
    depth += occurrences(line, '{') - occurrences(line, '}')
    if (depth < 0) return undefined
    for (const open of stack) if (depth > open.depth) open.opened = true
    while (stack.length > 0 && (stack[stack.length - 1]!.opened ? depth <= stack[stack.length - 1]!.depth : depth < stack[stack.length - 1]!.depth)) {
      stack.pop()
    }
  }
  return depth === 0 ? types : undefined
}

const occurrences = (line: string, ch: string): number => line.split(ch).length - 1

type Declaration = { kind: 'type'; name: string; signature: string } | { kind: 'member'; signature: string }

/** The declaration as one line: trailing brace, trailing punctuation and repeated spaces gone. */
const signatureOf = (code: string): string =>
  code
    .replace(/\s*\{\s*$/, '')
    .replace(/[;,]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const CS_TYPE = /\b(?:class|interface|record|struct|enum)\s+([A-Za-z_]\w*)/
const CS_PUBLIC = /(^|\s)public(\s|$)/

function csharpDeclaration(code: string): Declaration | undefined {
  if (!CS_PUBLIC.test(code)) return undefined
  const type = CS_TYPE.exec(code)
  if (type) return { kind: 'type', name: type[1]!, signature: signatureOf(code) }
  return { kind: 'member', signature: signatureOf(code) }
}

const TS_TYPES: RegExp[] = [
  /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+interface\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/,
  /^export\s+(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
]

/** Modifiers a member may carry before its name. */
const TS_MEMBER = /^(?:public\s+|static\s+|readonly\s+|abstract\s+|override\s+|async\s+|declare\s+|get\s+|set\s+)*[A-Za-z_$][\w$]*[?!]?\s*[(<:=]/

/** Words that start a statement, never a member. */
const TS_NOT_MEMBER = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'try', 'catch', 'finally', 'throw', 'new',
  'import', 'export', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'await', 'yield',
  'super', 'this', 'default', 'delete', 'typeof', 'void',
])

function typescriptDeclaration(code: string): Declaration | undefined {
  for (const pattern of TS_TYPES) {
    const match = pattern.exec(code)
    if (match) return { kind: 'type', name: match[1]!, signature: signatureOf(code) }
  }
  if (/^(?:private|protected|#)/.test(code)) return undefined
  const first = /^[A-Za-z_$][\w$]*/.exec(code)?.[0]
  if (first !== undefined && TS_NOT_MEMBER.has(first)) return undefined
  return TS_MEMBER.test(code) ? { kind: 'member', signature: signatureOf(code) } : undefined
}

/** The index of a project: its files scanned in path order, the unreadable ones named. */
export function buildTypeIndex(files: SourceFile[]): TypeIndex {
  const index: TypeIndex = { types: [], skipped: [] }
  for (const file of [...files].sort((a, b) => byPath(a.path, b.path))) {
    const found = scanPublicTypes(file.path, file.text)
    if (found === undefined) index.skipped.push(file.path)
    else index.types.push(...found)
  }
  return index
}

export const publicTypeCount = (index: TypeIndex): number => index.types.length

/** The file a session opens for a signature: one line per type, its members under it. */
export function renderTypeIndex(project: string, index: TypeIndex): string {
  const lines = [`# Public types: ${project}`, '', `${index.types.length} public types.`, '']
  let file = ''
  for (const type of index.types) {
    if (type.file !== file) {
      file = type.file
      lines.push(`## ${file}`)
    }
    lines.push(`${type.signature} (line ${type.line})`)
    for (const member of type.members) lines.push(`  ${member}`)
  }
  if (index.skipped.length > 0) {
    lines.push('', '## Skipped: the scan could not read these files', ...index.skipped)
  }
  return lines.join('\n')
}

import { extname } from 'node:path'
import { languageOf } from '../code-structure/language'
import { readStructure, type CodeBlock, type CodeItem } from '../code-structure/structure'
import { byPath } from './map-files'

/**
 * A project's public surface, read out of its source by the build itself: no
 * language service, no compiler, the same structure reading the size measure
 * uses. C# calls it `public`, TypeScript calls it `export`; both come
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

/**
 * Types anywhere in the file; a type's members are the declarations directly
 * in its body. A declaration is read from the first line it starts on, as
 * written there, so a one-line member keeps its accessors and a line holding
 * two statements is read once. What shares the type's own line is not a member.
 */
function scan(path: string, text: string, csharp: boolean): PublicType[] | undefined {
  const { items, code } = readStructure(path, text)
  if (!balanced(code)) return undefined
  const declared = (item: CodeItem): Declaration | undefined => {
    const line = code[item.line - 1]!.trim()
    return csharp ? csharpDeclaration(line) : typescriptDeclaration(line)
  }
  const types: PublicType[] = []
  const typeLines = new Set<number>()
  const visit = (list: CodeItem[]): void => {
    for (const item of list) {
      const found = typeLines.has(item.line) ? undefined : declared(item)
      typeLines.add(item.line)
      if (found?.kind === 'type') types.push({ file: path, line: item.line, name: found.name, signature: found.signature, members: item.kind === 'block' ? membersOf(item) : [] })
      if (item.kind === 'block') visit(item.children)
    }
  }
  const membersOf = (type: CodeBlock): string[] => {
    const read = new Set([type.line])
    const members: string[] = []
    for (const child of type.children) {
      if (read.has(child.line)) continue
      read.add(child.line)
      const found = declared(child)
      if (found?.kind === 'member') members.push(found.signature)
    }
    return members
  }
  visit(items)
  return types
}

/** Braces that never close more than they opened, and close all they open. */
function balanced(code: string[]): boolean {
  let depth = 0
  for (const line of code) {
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}' && --depth < 0) return false
    }
  }
  return depth === 0
}

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

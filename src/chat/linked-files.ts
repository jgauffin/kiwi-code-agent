import { isAbsolute, relative } from 'node:path'

/**
 * How a file linked from the editor is named in the prompt: workspace-relative
 * with forward slashes, absolute when it lies outside the workspace.
 */
export function linkedFilePath(workspaceRoot: string, file: string): string {
  const rel = relative(workspaceRoot, file).split('\\').join('/')
  if (rel === '' || rel.startsWith('../') || isAbsolute(rel)) return file.split('\\').join('/')
  return rel
}

/** The prompt for a send with linked files: the request, then the files it is about. */
export function withLinkedFiles(text: string, files: string[]): string {
  if (files.length === 0) return text
  const list = files.map((file) => `- ${file}`).join('\n')
  return `${text}\n\nRead these files first; the request is about them:\n${list}`
}

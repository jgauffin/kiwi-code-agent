/**
 * Files that decide what later runs without a prompt: the root `package.json`,
 * whose scripts run unasked; the workspace settings, which hold the allow
 * rules and the verify commands; and the MCP config, whose servers a session
 * starts. A write to one is always put to the user, whatever the Allow writes
 * switch, the scratch folder or an allow rule says. Otherwise a session could
 * grant itself its next command in two silent steps: write it into one of
 * these, then run it. Asking once here is what lets every later run go unasked.
 *
 * Paths are project-relative with forward slashes. The MCP config's name is
 * spelled here rather than imported, so permissions do not pull in the engine.
 */
const TRUST_FILES: ReadonlySet<string> = new Set(['package.json', '.vscode/settings.json', '.mcp.json', '.claude/settings.json', '.claude/settings.local.json'])

/** A workspace file at the root also carries settings, the allow rules among them. */
const WORKSPACE_FILE = /^[^/]+\.code-workspace$/

export function isTrustFile(relPath: string): boolean {
  return TRUST_FILES.has(relPath) || WORKSPACE_FILE.test(relPath)
}

/**
 * Is this a file the person's own permission rules are kept in? Those lie
 * outside every project, so they are judged by their absolute paths rather
 * than ones relative to a project root; a write to one is guarded the same way
 * a write to the workspace's own settings already is. Both sides normalized.
 */
export function isRulesFile(absolutePath: string, rulesFiles: readonly string[]): boolean {
  const caseless = process.platform === 'win32'
  const fold = (p: string) => (caseless ? p.toLowerCase() : p)
  return rulesFiles.some((file) => fold(file) === fold(absolutePath))
}

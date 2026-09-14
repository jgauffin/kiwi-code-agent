import type { SessionEvent } from '../session/code-session'

/**
 * The files a session changed, from its run log: every edit step that changed
 * something carries the file's absolute path on its result. First edit first,
 * each file once. Edits made through Bash are not steps of this kind and are
 * not seen.
 */
export function editedFiles(events: SessionEvent[]): string[] {
  const paths: string[] = []
  for (const event of events) {
    if (event.type !== 'tool_result' || event.isError || !event.edit) continue
    if (!paths.includes(event.edit.path)) paths.push(event.edit.path)
  }
  return paths
}

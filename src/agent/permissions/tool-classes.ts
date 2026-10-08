/**
 * What a tool's name says about the call, for every decision that is made
 * before the call's own arguments are read. Names here are bare on both
 * engines: the Claude engine takes its server prefix off before a hook sees
 * the call.
 */

/** Tools that take a file from one path to another; their input names both ends. */
export const TRANSFER_TOOLS: ReadonlySet<string> = new Set(['Move', 'Copy'])

/** Tools that write a file. A write is answered per call or per session, never remembered for the project. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'RunScript', ...TRANSFER_TOOLS])

/** Tools that write the one file their `file_path` names: what a contract on a file's content checks after the call. */
export const WRITES_NAMED_FILE: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit'])

/**
 * Tools that run a command line. Both are judged, prompted and remembered
 * command by command, each under its own tool name: a rule for one shell says
 * nothing about the other.
 */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])

export const isShellTool = (toolName: string): boolean => SHELL_TOOLS.has(toolName)

/**
 * Tools that spawn a subagent, under both the name the engine used to carry
 * and the one it uses now, and our own delegating tool. Their input names
 * the agent, which is what the output produced inside them is labelled with.
 */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'Delegate'])

export const isSubagentTool = (toolName: string): boolean => SUBAGENT_TOOLS.has(toolName)

/** Tools whose input names a path, so a rule's glob has something to match. */
export const FILE_TOOLS: ReadonlySet<string> = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep',
  'JsonSchema', 'JsonQuery', 'MarkdownSearch', 'CodeOutline', 'CodeSearch', 'LS', 'ReadDir', 'Exists',
  // Its staged changes name their files; the rules judge them as they judge any other write.
  'RunScript',
  ...TRANSFER_TOOLS,
])

/**
 * Looking about the file system rather than at a file already named. These
 * carry no `readOnly` of their own, being names a script's own calls are gated
 * under rather than tools a session is given, so they are named here to be
 * judged as the looking they are.
 */
export const WITHIN_PROJECT_TOOLS: ReadonlySet<string> = new Set(['ReadDir', 'Exists'])

/**
 * The engine's own tools that only look. The tools this extension implements
 * are not listed: they carry the answer themselves, and `readOnlyTools` below
 * prefers it, so there is one place to state it per tool.
 *
 * Only looking is not on its own leave to run: a call is judged by where it
 * looks as well, so reading stays inside the project exactly as writing does.
 */
const BUILT_IN_READ_ONLY: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoRead', 'TodoWrite', 'Skill'])

/** Does this tool only look? Asked by name, because a hook is given the name and not the tool. */
export type ReadOnlyTools = (toolName: string) => boolean

/**
 * The one rule: a tool we serve answers for itself, an engine built-in is
 * judged by the list above, and anything else — an MCP server's tool, or one
 * this session was never given — is presumed to change something and asked
 * about. `own` is read on each call, since a session's tools are built after
 * its policy.
 */
export function readOnlyTools(own: () => readonly { name: string; readOnly: boolean }[]): ReadOnlyTools {
  return (toolName) => own().find((tool) => tool.name === toolName)?.readOnly ?? BUILT_IN_READ_ONLY.has(toolName)
}

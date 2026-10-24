/**
 * The Claude engine runs a command in the background by itself, through its own Bash
 * and a pair of tools to read and stop it. Switched off, so a session on either
 * engine runs background commands only through ours, which any engine can be told
 * of, survive an engine switch, and show in the transcript.
 */
export const CLAUDE_OWN_BACKGROUND_TOOLS = ['BashOutput', 'KillShell', 'Monitor']

/** Takes the `run_in_background` option off the engine's own Bash. */
export const CLAUDE_OWN_BACKGROUND_OFF_ENV = { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }

import { AGENT_DIR } from '../repo-map/workspace-scan'

/**
 * A session's own folder for throwaway scripts and experiments. It lies inside
 * the project so the project's permission rules hold there, and the session
 * writes it without a prompt, where the system temp dir would ask every time.
 */
export const scratchDir = (sessionId: string): string => `${AGENT_DIR}/scratch/${sessionId}`

export const scratchInstruction = (dir: string): string =>
  `Throwaway scripts, probes and experiments go in ${dir}, written with Write; it needs no permission. Never use the system temp directory.`

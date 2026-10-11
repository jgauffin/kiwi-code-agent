import { KIWI_DIR } from '../kiwi-dir'

/**
 * A session's own folder for throwaway scripts and experiments. It lies inside
 * the project so the project's permission rules hold there, and the session
 * writes it without a prompt, where the system temp dir would ask every time.
 * Named by the start of the session's id: short enough that a model writes it
 * out in each command instead of keeping it in a variable or a `cd`.
 */
export const scratchDir = (sessionId: string): string => `${KIWI_DIR}/scratch/${sessionId.slice(0, 8)}`

/**
 * Running a script the session wrote is a program of its own and stays asked,
 * so the folder is offered for what lands there, and computing goes to RunScript.
 */
export const scratchInstruction = (dir: string): string =>
  `Your scratch folder is ${dir}. Writing or deleting there runs without a permission prompt, through Write or a shell redirect: captured command output, notes, data files. ` +
  'Write the path out in each command that uses it; never keep it in a shell variable or cd into it. ' +
  'Compute an answer over files with a RunScript program, never a script written there and run with node or python: running a program you wrote waits for the person to approve it. ' +
  'Write and run one only when RunScript cannot do the job, such as spawning a process, loading a package or reaching the network. Never use the system temp directory.'

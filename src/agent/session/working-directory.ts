/**
 * Where a session works, said in every prompt on both engines: told only that
 * it is "in" a project, a model opens each shell command with a cd to the root
 * and spells tool paths out from the drive, so the prompt names the directory
 * and says the tools are already there.
 */
export const workingDirectoryInstruction = (cwd: string, platform: string = process.platform): string =>
  `You work in ${cwd} on ${platform}: every shell command already starts there and a relative path in a tool call resolves there, so no command needs a cd to reach it.`

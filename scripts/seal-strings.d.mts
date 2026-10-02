/** Defines `__kp` at the top of the bundle; every sealed string calls it. */
export const SEAL_DECODER: string
export function encode(text: string): string
/** The esbuild plugin: the extension's own TypeScript and the markdown it embeds, sealed on load. */
export function sealStrings(): { name: string; setup(build: unknown): void }
/** One TypeScript file as JavaScript, its long strings and templates sealed. */
export function sealSource(source: string, fileName: string): string

/** What a caught value says: an error's message, anything else as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

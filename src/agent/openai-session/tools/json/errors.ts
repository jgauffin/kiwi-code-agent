/** A failure the caller can act on. Always names the file it happened in. */
export class DataError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "DataError";
  }
}

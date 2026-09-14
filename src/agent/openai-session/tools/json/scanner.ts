/**
 * Incremental JSON tokenizer.
 *
 * Chunks are pushed in as they arrive from a stream, so the memory used to read
 * a file is bounded by the largest single value in it rather than by the file
 * size. Strings are clipped while they are being read, so one enormous string
 * cannot exhaust memory either; the true length is always reported.
 */

export type JsonPrimitive = string | number | boolean | null;

/** How much of a single string is kept in memory. The rest is counted, not stored. */
export const MAX_SCANNED_STRING = 64 * 1024;

/** Nesting depth beyond which a document is rejected rather than followed. */
export const MAX_SCAN_DEPTH = 200;

/** A string too long to keep whole. Carries what was read plus the real length. */
export class LongString {
  constructor(
    readonly text: string,
    readonly totalLength: number,
  ) {}

  toString(): string {
    return this.text;
  }
}

export type ScannedValue = JsonPrimitive | LongString;

export type Token =
  | { t: "startObject" }
  | { t: "endObject" }
  | { t: "startArray" }
  | { t: "endArray" }
  | { t: "key"; name: string }
  | { t: "value"; value: ScannedValue };

export type PathSegment = string | number;

export class JsonSyntaxError extends Error {
  readonly offset: number;
  readonly jsonPath: string;

  constructor(message: string, offset: number, jsonPath: string) {
    super(`${message} at character ${offset}, path ${jsonPath}`);
    this.name = "JsonSyntaxError";
    this.offset = offset;
    this.jsonPath = jsonPath;
  }
}

/** Render a path as `$.orders[3].customer.name` for error messages and results. */
export function formatPath(segments: readonly PathSegment[]): string {
  let out = "$";
  for (const segment of segments) {
    if (typeof segment === "number") out += `[${segment}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) out += `.${segment}`;
    else out += `[${JSON.stringify(segment)}]`;
  }
  return out;
}

enum S {
  Value,
  AfterValue,
  ObjectStart,
  Key,
  Colon,
  InString,
  InStringEscape,
  InUnicode,
  InNumber,
  InLiteral,
}

interface Frame {
  kind: "object" | "array";
  index: number;
}

const NUMBER_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const NUMBER_CHARS = new Set("-+.eE0123456789");

export interface TokenizerOptions {
  /** Called for every token. `tokenizer.path` describes where the token came from. */
  onToken: (token: Token) => void;
}

export class JsonTokenizer {
  /**
   * Path of the value currently being emitted. Valid only inside `onToken`;
   * copy it if you need to keep it.
   */
  readonly path: PathSegment[] = [];

  private readonly onToken: (token: Token) => void;
  private readonly stack: Frame[] = [];
  private state = S.Value;
  private offset = 0;
  private sawValue = false;

  private stringBuffer = "";
  private stringLength = 0;
  private stringIsKey = false;
  private unicodeDigits = "";
  private tokenBuffer = "";

  constructor(options: TokenizerOptions) {
    this.onToken = options.onToken;
  }

  /** Feed decoded text. Throws JsonSyntaxError on malformed input. */
  write(text: string): void {
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      this.offset++;

      switch (this.state) {
        case S.Value:
          if (isWhitespace(c)) break;
          if (c === "]" && this.isEmptyArrayEnd()) this.closeContainer("array");
          else this.startValue(c);
          break;

        case S.AfterValue:
          if (isWhitespace(c)) break;
          this.afterValue(c);
          break;

        case S.ObjectStart:
          if (isWhitespace(c)) break;
          if (c === "}") {
            this.closeContainer("object");
          } else if (c === '"') {
            this.beginString(true);
          } else {
            throw this.fail(`expected '"' or '}' but found ${describe(c)}`);
          }
          break;

        case S.Key:
          if (isWhitespace(c)) break;
          if (c === '"') this.beginString(true);
          else throw this.fail(`expected '"' to start an object key but found ${describe(c)}`);
          break;

        case S.Colon:
          if (isWhitespace(c)) break;
          if (c === ":") this.state = S.Value;
          else throw this.fail(`expected ':' after object key but found ${describe(c)}`);
          break;

        case S.InString:
          if (c === '"') this.endString();
          else if (c === "\\") this.state = S.InStringEscape;
          else if (c < " ") throw this.fail(`unescaped control character in string`);
          else this.pushStringChar(c);
          break;

        case S.InStringEscape: {
          const escaped = ESCAPES[c];
          if (escaped !== undefined) {
            this.pushStringChar(escaped);
            this.state = S.InString;
          } else if (c === "u") {
            this.unicodeDigits = "";
            this.state = S.InUnicode;
          } else {
            throw this.fail(`invalid escape sequence \\${c}`);
          }
          break;
        }

        case S.InUnicode:
          if (!/[0-9a-fA-F]/.test(c)) throw this.fail(`invalid \\u escape: ${describe(c)}`);
          this.unicodeDigits += c;
          if (this.unicodeDigits.length === 4) {
            this.pushStringChar(String.fromCharCode(parseInt(this.unicodeDigits, 16)));
            this.state = S.InString;
          }
          break;

        case S.InNumber:
          if (NUMBER_CHARS.has(c)) {
            this.tokenBuffer += c;
          } else {
            this.endNumber();
            // The character terminating the number still has to be handled.
            i--;
            this.offset--;
          }
          break;

        case S.InLiteral:
          if (c >= "a" && c <= "z") {
            this.tokenBuffer += c;
          } else {
            this.endLiteral();
            i--;
            this.offset--;
          }
          break;
      }
    }
  }

  /** Signal end of input. Throws if the document is incomplete. */
  end(): void {
    if (this.state === S.InNumber) this.endNumber();
    else if (this.state === S.InLiteral) this.endLiteral();

    if (this.stack.length > 0) throw this.fail("unexpected end of input inside an unclosed object or array");
    if (this.state !== S.AfterValue) {
      if (!this.sawValue) throw this.fail("unexpected end of input: the document is empty");
      throw this.fail("unexpected end of input");
    }
  }

  /** True when a ']' closes an array that never got an element, as opposed to a trailing comma. */
  private isEmptyArrayEnd(): boolean {
    const frame = this.stack[this.stack.length - 1];
    return frame?.kind === "array" && frame.index === 0;
  }

  private startValue(c: string): void {
    switch (c) {
      case "{":
        this.emit({ t: "startObject" });
        this.stack.push({ kind: "object", index: 0 });
        this.path.push("");
        this.guardDepth();
        this.state = S.ObjectStart;
        break;
      case "[":
        this.emit({ t: "startArray" });
        this.stack.push({ kind: "array", index: 0 });
        this.path.push(0);
        this.guardDepth();
        this.state = S.Value;
        break;
      case '"':
        this.beginString(false);
        break;
      default:
        if (c === "-" || (c >= "0" && c <= "9")) {
          this.tokenBuffer = c;
          this.state = S.InNumber;
        } else if (c >= "a" && c <= "z") {
          this.tokenBuffer = c;
          this.state = S.InLiteral;
        } else {
          throw this.fail(`expected a value but found ${describe(c)}`);
        }
    }
  }

  private afterValue(c: string): void {
    const frame = this.stack[this.stack.length - 1];
    if (c === ",") {
      if (!frame) throw this.fail("found ',' after the end of the document");
      if (frame.kind === "array") {
        frame.index++;
        this.path[this.path.length - 1] = frame.index;
        this.state = S.Value;
      } else {
        this.state = S.Key;
      }
    } else if (c === "}") {
      if (frame?.kind !== "object") throw this.fail("found '}' but no object is open");
      this.closeContainer("object");
    } else if (c === "]") {
      if (frame?.kind !== "array") throw this.fail("found ']' but no array is open");
      this.closeContainer("array");
    } else {
      throw this.fail(`expected ',' or a closing bracket but found ${describe(c)}`);
    }
  }

  private closeContainer(kind: "object" | "array"): void {
    this.stack.pop();
    this.path.pop();
    this.emit(kind === "object" ? { t: "endObject" } : { t: "endArray" });
    this.state = S.AfterValue;
  }

  private beginString(isKey: boolean): void {
    this.stringBuffer = "";
    this.stringLength = 0;
    this.stringIsKey = isKey;
    this.state = S.InString;
  }

  private pushStringChar(c: string): void {
    this.stringLength++;
    if (this.stringBuffer.length < MAX_SCANNED_STRING) this.stringBuffer += c;
  }

  private endString(): void {
    if (this.stringIsKey) {
      const name = this.stringBuffer;
      this.path[this.path.length - 1] = name;
      this.emit({ t: "key", name });
      this.state = S.Colon;
      return;
    }

    const value =
      this.stringLength > this.stringBuffer.length
        ? new LongString(this.stringBuffer, this.stringLength)
        : this.stringBuffer;
    this.emitValue(value);
  }

  private endNumber(): void {
    if (!NUMBER_PATTERN.test(this.tokenBuffer)) {
      throw this.fail(`invalid number "${this.tokenBuffer}"`);
    }
    this.emitValue(Number(this.tokenBuffer));
  }

  private endLiteral(): void {
    if (this.tokenBuffer === "true") this.emitValue(true);
    else if (this.tokenBuffer === "false") this.emitValue(false);
    else if (this.tokenBuffer === "null") this.emitValue(null);
    else throw this.fail(`expected true, false or null but found "${this.tokenBuffer}"`);
  }

  private emitValue(value: ScannedValue): void {
    this.emit({ t: "value", value });
    this.state = S.AfterValue;
  }

  private emit(token: Token): void {
    this.sawValue = true;
    this.onToken(token);
  }

  private guardDepth(): void {
    if (this.stack.length > MAX_SCAN_DEPTH) {
      throw this.fail(`nesting deeper than ${MAX_SCAN_DEPTH} levels`);
    }
  }

  private fail(message: string): JsonSyntaxError {
    return new JsonSyntaxError(message, this.offset, formatPath(this.path));
  }
}

const ESCAPES: Record<string, string | undefined> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function isWhitespace(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t";
}

function describe(c: string): string {
  return c === "\n" ? "a line break" : `'${c}'`;
}

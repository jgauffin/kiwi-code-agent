/**
 * Turns a file into a stream of tokens, and a stream of tokens into the items a
 * path selects. Format lives here and nowhere else: adding CSV or Parquet means
 * adding a reader below, not touching a single tool.
 */

import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { JsonTokenizer, JsonSyntaxError, LongString } from "./scanner.js";
import type { PathSegment, Token } from "./scanner.js";
import type { PathStep } from "./expr.js";
import { DataError } from "./errors.js";

/** Nodes a single selected item may contain before the selection is refused. */
export const MAX_CAPTURE_NODES = 200_000;

export type DataFormat = "json" | "jsonl";

export interface DataFile {
  /** Path as the caller wrote it. Used in errors and in results. */
  relativePath: string;
  format: DataFormat;
  open(): Promise<Readable>;
}

export interface Selected {
  path: PathSegment[];
  value: unknown;
}

export type TokenHandler = (token: Token, path: readonly PathSegment[]) => void;

export function detectFormat(relativePath: string): DataFormat {
  return /\.(jsonl|ndjson)$/i.test(relativePath) ? "jsonl" : "json";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/** Drive `handler` over every token in the file. Memory stays bounded. */
export async function scanTokens(file: DataFile, handler: TokenHandler): Promise<void> {
  if (file.format === "jsonl") return scanJsonLines(file, handler);
  return scanJson(file, handler);
}

async function scanJson(file: DataFile, handler: TokenHandler): Promise<void> {
  const tokenizer = new JsonTokenizer({ onToken: (token) => handler(token, tokenizer.path) });
  const decoder = new StringDecoder("utf8");
  const stream = await file.open();

  try {
    for await (const chunk of stream) {
      tokenizer.write(decoder.write(chunk as Buffer));
    }
    const tail = decoder.end();
    if (tail) tokenizer.write(tail);
    tokenizer.end();
  } catch (err) {
    if (err instanceof JsonSyntaxError) throw new DataError(file.relativePath, err.message);
    throw err;
  } finally {
    stream.destroy();
  }
}

/**
 * A JSONL file behaves exactly like a top-level array, so the same paths work
 * against both formats: `$[*]` is the records, `$[*].total` a field of each.
 */
async function scanJsonLines(file: DataFile, handler: TokenHandler): Promise<void> {
  const path: PathSegment[] = [];
  const emit = createValueEmitter(handler, path);

  handler({ t: "startArray" }, path);
  path.push(0);

  let index = 0;
  await forEachLine(file, (line, lineNumber) => {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (err) {
      throw new DataError(
        file.relativePath,
        `line ${lineNumber} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    path[path.length - 1] = index;
    emit(record);
    index++;
  });

  path.pop();
  handler({ t: "endArray" }, path);
}

async function forEachLine(
  file: DataFile,
  visit: (line: string, lineNumber: number) => void,
): Promise<void> {
  const decoder = new StringDecoder("utf8");
  const stream = await file.open();
  let pending = "";
  let lineNumber = 0;

  const flush = (text: string, last: boolean): void => {
    pending += text;
    let start = 0;
    for (;;) {
      const newline = pending.indexOf("\n", start);
      if (newline === -1) break;
      lineNumber++;
      const line = pending.slice(start, newline).trim();
      if (line !== "") visit(line, lineNumber);
      start = newline + 1;
    }
    pending = pending.slice(start);
    if (last) {
      const line = pending.trim();
      if (line !== "") visit(line, lineNumber + 1);
      pending = "";
    }
  };

  try {
    for await (const chunk of stream) {
      flush(decoder.write(chunk as Buffer), false);
    }
    flush(decoder.end(), true);
  } finally {
    stream.destroy();
  }
}

/** Replay an in-memory value as tokens, keeping `path` in step with the walk. */
function createValueEmitter(handler: TokenHandler, path: PathSegment[]): (value: unknown) => void {
  const emit = (value: unknown): void => {
    if (Array.isArray(value)) {
      handler({ t: "startArray" }, path);
      path.push(0);
      for (let i = 0; i < value.length; i++) {
        path[path.length - 1] = i;
        emit(value[i]);
      }
      path.pop();
      handler({ t: "endArray" }, path);
      return;
    }

    if (value !== null && typeof value === "object" && !(value instanceof LongString)) {
      handler({ t: "startObject" }, path);
      path.push("");
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        path[path.length - 1] = key;
        handler({ t: "key", name: key }, path);
        emit(child);
      }
      path.pop();
      handler({ t: "endObject" }, path);
      return;
    }

    handler({ t: "value", value: value as never }, path);
  };

  return emit;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────────────

export function matchesPath(path: readonly PathSegment[], steps: readonly PathStep[]): boolean {
  if (path.length !== steps.length) return false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const segment = path[i]!;
    if (step.kind === "wildcard") continue;
    if (step.kind === "key" && segment !== step.name) return false;
    if (step.kind === "index" && segment !== step.index) return false;
  }

  return true;
}

/** Rebuilds one selected subtree from the token stream. */
export class ValueBuilder {
  private readonly stack: Array<{ container: unknown; key: string | null }> = [];
  private nodes = 0;
  value: unknown;
  done = false;

  constructor(private readonly file: string) {}

  /** Returns true once the selected value is complete. */
  add(token: Token): boolean {
    switch (token.t) {
      case "startObject":
        this.open({});
        break;
      case "startArray":
        this.open([]);
        break;
      case "key": {
        const frame = this.stack[this.stack.length - 1];
        if (frame) frame.key = token.name;
        break;
      }
      case "value":
        this.attach(token.value);
        break;
      case "endObject":
      case "endArray": {
        const frame = this.stack.pop()!;
        if (this.stack.length === 0) {
          this.value = frame.container;
          this.done = true;
        }
        break;
      }
    }
    return this.done;
  }

  private open(container: unknown): void {
    this.count();
    if (this.stack.length > 0) this.attachTo(container);
    this.stack.push({ container, key: null });
  }

  private attach(value: unknown): void {
    this.count();
    if (this.stack.length === 0) {
      this.value = value;
      this.done = true;
      return;
    }
    this.attachTo(value);
  }

  private attachTo(value: unknown): void {
    const frame = this.stack[this.stack.length - 1]!;
    if (Array.isArray(frame.container)) frame.container.push(value);
    else (frame.container as Record<string, unknown>)[frame.key ?? ""] = value;
  }

  private count(): void {
    if (++this.nodes > MAX_CAPTURE_NODES) {
      throw new DataError(
        this.file,
        `a single selected value holds more than ${MAX_CAPTURE_NODES} nodes. Narrow the expression, for example "$.orders[*]" instead of "$.orders".`,
      );
    }
  }
}

/**
 * Call `visit` for every item the path selects. Only the item being built is
 * held in memory, so a selection of many small items costs the size of one.
 */
export async function selectItems(
  file: DataFile,
  steps: readonly PathStep[],
  visit: (item: Selected) => void,
): Promise<void> {
  let builder: ValueBuilder | null = null;
  let capturePath: PathSegment[] = [];

  await scanTokens(file, (token, path) => {
    if (builder) {
      if (builder.add(token)) {
        visit({ path: capturePath, value: builder.value });
        builder = null;
      }
      return;
    }

    if (token.t === "key" || token.t === "endObject" || token.t === "endArray") return;
    if (!matchesPath(path, steps)) return;

    if (token.t === "value") {
      visit({ path: [...path], value: token.value });
      return;
    }

    capturePath = [...path];
    builder = new ValueBuilder(file.relativePath);
    builder.add(token);
  });
}

/**
 * The query expression language.
 *
 * A whole-document query engine (JSONPath, JSONata) would have to hold the file
 * in memory, which is the thing these tools exist to avoid. So the language is
 * deliberately small: a leading path that can be matched against a streaming
 * tokenizer, followed by stages that run on one selected item at a time.
 *
 *   $.orders[*] | select(.total > 100 and .status == "open") | {id, name: .customer.name}
 */

import { LongString } from "./scanner.js";

export type PathStep =
  | { kind: "key"; name: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "startswith" | "endswith";

export type Predicate =
  | { kind: "and"; left: Predicate; right: Predicate }
  | { kind: "or"; left: Predicate; right: Predicate }
  | { kind: "not"; operand: Predicate }
  | { kind: "compare"; path: PathStep[]; op: CompareOp; literal: string | number | boolean | null }
  | { kind: "exists"; path: PathStep[]; negated: boolean };

export interface ProjectionField {
  name: string;
  path: PathStep[];
}

export type Stage =
  | { kind: "select"; predicate: Predicate }
  | { kind: "project"; fields: ProjectionField[] }
  | { kind: "keys" }
  | { kind: "values" }
  | { kind: "length" };

export interface Expression {
  /** Matched against the streaming tokenizer to pick items out of the file. */
  path: PathStep[];
  /** Applied to each selected item, in order. */
  stages: Stage[];
}

export class ExpressionError extends Error {
  constructor(message: string, readonly source: string, readonly offset: number) {
    super(`${message} (at character ${offset} of "${source}")`);
    this.name = "ExpressionError";
  }
}

/** Marker for "this path does not exist here", distinct from a stored null. */
export const MISSING = Symbol("missing");

// ─────────────────────────────────────────────────────────────────────────────
// Lexer
// ─────────────────────────────────────────────────────────────────────────────

type TokenType = "punct" | "op" | "ident" | "number" | "string" | "end";

interface ExprToken {
  type: TokenType;
  text: string;
  value?: string | number;
  offset: number;
}

const PUNCT = new Set([".", "[", "]", "{", "}", "(", ")", ",", ":", "|", "*", "$"]);

function lex(source: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i]!;

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    if (c === "=" || c === "!" || c === "<" || c === ">") {
      const two = source.slice(i, i + 2);
      if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
        tokens.push({ type: "op", text: two, offset: i });
        i += 2;
        continue;
      }
      if (c === "<" || c === ">") {
        tokens.push({ type: "op", text: c, offset: i });
        i++;
        continue;
      }
      throw new ExpressionError(`unexpected '${c}' (did you mean '==' or '!='?)`, source, i);
    }

    if (PUNCT.has(c)) {
      tokens.push({ type: "punct", text: c, offset: i });
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const { text, next } = readQuoted(source, i, c);
      tokens.push({ type: "string", text: source.slice(i, next), value: text, offset: i });
      i = next;
      continue;
    }

    if (c === "-" || (c >= "0" && c <= "9")) {
      const match = /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(source.slice(i));
      if (!match) throw new ExpressionError("malformed number", source, i);
      tokens.push({ type: "number", text: match[0], value: Number(match[0]), offset: i });
      i += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i))!;
      tokens.push({ type: "ident", text: match[0], offset: i });
      i += match[0].length;
      continue;
    }

    throw new ExpressionError(`unexpected character '${c}'`, source, i);
  }

  tokens.push({ type: "end", text: "<end of expression>", offset: source.length });
  return tokens;
}

function readQuoted(source: string, start: number, quote: string): { text: string; next: number } {
  let out = "";
  let i = start + 1;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\\") {
      const escaped = source[i + 1];
      if (escaped === undefined) break;
      out += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
      i += 2;
      continue;
    }
    if (c === quote) return { text: out, next: i + 1 };
    out += c;
    i++;
  }
  throw new ExpressionError("unterminated string literal", source, start);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: ExprToken[],
  ) {}

  parseExpression(): Expression {
    if (this.at("punct", "$")) this.next();
    const path = this.parsePathSteps(true);

    const stages: Stage[] = [];
    while (this.at("punct", "|")) {
      this.next();
      stages.push(this.parseStage());
    }

    const token = this.peek();
    if (token.type !== "end") throw this.error(`unexpected ${token.text}`, token);
    return { path, stages };
  }

  /** A path written on its own, accepting `.a.b`, `a.b` and `$.a.b` alike. */
  parseBarePath(): PathStep[] {
    if (this.at("punct", "$")) this.next();
    const steps = this.parseBareOrRelativePath();
    const token = this.peek();
    if (token.type !== "end") throw this.error(`unexpected ${token.text}`, token);
    return steps;
  }

  /** A path used on the right of a stage, which must start with '.' or '['. */
  parseRelativePath(): PathStep[] {
    const token = this.peek();
    if (!this.at("punct", ".") && !this.at("punct", "[")) {
      throw this.error(`expected a path starting with '.' but found ${token.text}`, token);
    }
    return this.parsePathSteps(false);
  }

  private parsePathSteps(allowWildcard: boolean): PathStep[] {
    const steps: PathStep[] = [];

    for (;;) {
      if (this.at("punct", ".")) {
        const dot = this.next();
        const name = this.peek();
        if (name.type !== "ident") throw this.error(`expected a key name after '.' but found ${name.text}`, dot);
        this.next();
        steps.push({ kind: "key", name: name.text });
        continue;
      }

      if (this.at("punct", "[")) {
        const open = this.next();
        const inner = this.peek();

        if (inner.type === "punct" && inner.text === "*") {
          this.next();
          if (!allowWildcard) throw this.error("[*] is only allowed in the leading path", inner);
          steps.push({ kind: "wildcard" });
        } else if (inner.type === "number") {
          this.next();
          if (!Number.isInteger(inner.value as number) || (inner.value as number) < 0) {
            throw this.error("array index must be a non-negative whole number", inner);
          }
          steps.push({ kind: "index", index: inner.value as number });
        } else if (inner.type === "string") {
          this.next();
          steps.push({ kind: "key", name: inner.value as string });
        } else {
          throw this.error(`expected an index, '*' or a quoted key after '[' but found ${inner.text}`, open);
        }

        this.expect("punct", "]");
        continue;
      }

      return steps;
    }
  }

  private parseStage(): Stage {
    if (this.at("punct", "{")) return this.parseProjection();

    const token = this.peek();
    if (token.type !== "ident") throw this.error(`expected a stage name but found ${token.text}`, token);

    switch (token.text) {
      case "select": {
        this.next();
        this.expect("punct", "(");
        const predicate = this.parseOr();
        this.expect("punct", ")");
        return { kind: "select", predicate };
      }
      case "keys":
        this.next();
        return { kind: "keys" };
      case "values":
        this.next();
        return { kind: "values" };
      case "length":
        this.next();
        return { kind: "length" };
      default:
        throw this.error(
          `unknown stage "${token.text}". Available: select(...), {projection}, keys, values, length`,
          token,
        );
    }
  }

  private parseProjection(): Stage {
    this.expect("punct", "{");
    const fields: ProjectionField[] = [];

    for (;;) {
      const first = this.peek();
      if (first.type !== "ident") throw this.error(`expected a field name but found ${first.text}`, first);
      this.next();

      if (this.at("punct", ":")) {
        this.next();
        fields.push({ name: first.text, path: this.parseBareOrRelativePath() });
      } else {
        // `{customer.name}` keeps the written path as the output key.
        const rest = this.parsePathSteps(false);
        const steps: PathStep[] = [{ kind: "key", name: first.text }, ...rest];
        fields.push({ name: stepsToName(steps), path: steps });
      }

      if (this.at("punct", ",")) {
        this.next();
        continue;
      }
      break;
    }

    this.expect("punct", "}");
    if (fields.length === 0) throw this.error("projection must name at least one field", this.peek());
    return { kind: "project", fields };
  }

  /** Accepts both `.customer.name` and `customer.name`. */
  private parseBareOrRelativePath(): PathStep[] {
    const token = this.peek();
    if (token.type === "ident") {
      this.next();
      return [{ kind: "key", name: token.text }, ...this.parsePathSteps(false)];
    }
    return this.parseRelativePath();
  }

  private parseOr(): Predicate {
    let left = this.parseAnd();
    while (this.at("ident", "or")) {
      this.next();
      left = { kind: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Predicate {
    let left = this.parseUnary();
    while (this.at("ident", "and")) {
      this.next();
      left = { kind: "and", left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Predicate {
    if (this.at("ident", "not")) {
      this.next();
      return { kind: "not", operand: this.parseUnary() };
    }
    if (this.at("punct", "(")) {
      this.next();
      const inner = this.parseOr();
      this.expect("punct", ")");
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): Predicate {
    const path = this.parseRelativePath();
    const token = this.peek();

    if (token.type === "ident" && (token.text === "exists" || token.text === "missing")) {
      this.next();
      return { kind: "exists", path, negated: token.text === "missing" };
    }

    let op: CompareOp;
    if (token.type === "op") {
      op = token.text as CompareOp;
    } else if (
      token.type === "ident" &&
      (token.text === "contains" || token.text === "startswith" || token.text === "endswith")
    ) {
      op = token.text;
    } else {
      throw this.error(
        `expected a comparison (== != > >= < <= contains startswith endswith exists missing) but found ${token.text}`,
        token,
      );
    }
    this.next();

    return { kind: "compare", path, op, literal: this.parseLiteral() };
  }

  private parseLiteral(): string | number | boolean | null {
    const token = this.peek();
    if (token.type === "string") {
      this.next();
      return token.value as string;
    }
    if (token.type === "number") {
      this.next();
      return token.value as number;
    }
    if (token.type === "ident") {
      if (token.text === "true" || token.text === "false") {
        this.next();
        return token.text === "true";
      }
      if (token.text === "null") {
        this.next();
        return null;
      }
    }
    throw this.error(
      `expected a value (a number, a quoted string, true, false or null) but found ${token.text}`,
      token,
    );
  }

  private peek(): ExprToken {
    return this.tokens[this.pos]!;
  }

  private next(): ExprToken {
    const token = this.tokens[this.pos]!;
    if (token.type !== "end") this.pos++;
    return token;
  }

  private at(type: TokenType, text: string): boolean {
    const token = this.peek();
    return token.type === type && token.text === text;
  }

  private expect(type: TokenType, text: string): ExprToken {
    const token = this.peek();
    if (token.type !== type || token.text !== text) {
      throw this.error(`expected '${text}' but found ${token.text}`, token);
    }
    return this.next();
  }

  private error(message: string, token: ExprToken): ExpressionError {
    return new ExpressionError(message, this.source, token.offset);
  }
}

export function parseExpression(source: string): Expression {
  const trimmed = source.trim();
  if (trimmed === "") throw new ExpressionError("the expression is empty", source, 0);
  return new Parser(trimmed, lex(trimmed)).parseExpression();
}

/** Parse a path used on its own, such as json_stat's `value` and `group_by`. */
export function parsePath(source: string, label: string): PathStep[] {
  const trimmed = source.trim();
  if (trimmed === "") throw new ExpressionError(`${label} is empty`, source, 0);
  const steps = new Parser(trimmed, lex(trimmed)).parseBarePath();
  if (steps.length === 0) throw new ExpressionError(`${label} must name at least one key`, trimmed, 0);
  return steps;
}

function stepsToName(steps: PathStep[]): string {
  return steps
    .map((s) => (s.kind === "key" ? s.name : s.kind === "index" ? String(s.index) : "*"))
    .join(".");
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

export function resolvePath(value: unknown, steps: readonly PathStep[]): unknown | typeof MISSING {
  let current: unknown = value;

  for (const step of steps) {
    if (current === null || current === undefined) return MISSING;

    if (step.kind === "key") {
      if (typeof current !== "object" || Array.isArray(current)) return MISSING;
      const record = current as Record<string, unknown>;
      if (!(step.name in record)) return MISSING;
      current = record[step.name];
    } else if (step.kind === "index") {
      if (!Array.isArray(current) || step.index >= current.length) return MISSING;
      current = current[step.index];
    } else {
      return MISSING;
    }
  }

  return current;
}

/** Plain text of a value, so clipped strings compare on what was read. */
function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof LongString) return value.text;
  return null;
}

function comparable(value: unknown): string | number | boolean | null | undefined {
  const text = asText(value);
  if (text !== null) return text;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function compare(value: unknown, op: CompareOp, literal: string | number | boolean | null): boolean {
  if (op === "contains" || op === "startswith" || op === "endswith") {
    if (Array.isArray(value)) {
      return op === "contains" && value.some((item) => comparable(item) === literal);
    }
    const text = asText(value);
    if (text === null || typeof literal !== "string") return false;
    if (op === "contains") return text.includes(literal);
    if (op === "startswith") return text.startsWith(literal);
    return text.endsWith(literal);
  }

  const left = comparable(value);
  if (left === undefined) return op === "!=";

  if (op === "==") return left === literal;
  if (op === "!=") return left !== literal;

  // Ordering only makes sense within a type; across types the answer is "no".
  if (typeof left !== typeof literal) return false;
  if (typeof left === "boolean" || left === null || literal === null) return false;

  const right = literal as string | number;
  if (op === ">") return left > right;
  if (op === ">=") return left >= right;
  if (op === "<") return left < right;
  return left <= right;
}

export function evaluatePredicate(item: unknown, predicate: Predicate): boolean {
  switch (predicate.kind) {
    case "and":
      return evaluatePredicate(item, predicate.left) && evaluatePredicate(item, predicate.right);
    case "or":
      return evaluatePredicate(item, predicate.left) || evaluatePredicate(item, predicate.right);
    case "not":
      return !evaluatePredicate(item, predicate.operand);
    case "exists": {
      const found = resolvePath(item, predicate.path) !== MISSING;
      return predicate.negated ? !found : found;
    }
    case "compare": {
      const value = resolvePath(item, predicate.path);
      if (value === MISSING) return predicate.op === "!=";
      return compare(value, predicate.op, predicate.literal);
    }
  }
}

export interface StageResult {
  /** False when a select stage dropped the item. */
  kept: boolean;
  value: unknown;
}

export function applyStages(item: unknown, stages: readonly Stage[]): StageResult {
  let current = item;

  for (const stage of stages) {
    switch (stage.kind) {
      case "select":
        if (!evaluatePredicate(current, stage.predicate)) return { kept: false, value: undefined };
        break;

      case "project": {
        const projected: Record<string, unknown> = {};
        for (const field of stage.fields) {
          const value = resolvePath(current, field.path);
          projected[field.name] = value === MISSING ? null : value;
        }
        current = projected;
        break;
      }

      case "keys":
        current = Array.isArray(current)
          ? current.map((_, index) => index)
          : current !== null && typeof current === "object"
            ? Object.keys(current as Record<string, unknown>)
            : [];
        break;

      case "values":
        current = Array.isArray(current)
          ? current
          : current !== null && typeof current === "object"
            ? Object.values(current as Record<string, unknown>)
            : [];
        break;

      case "length": {
        const text = asText(current);
        current =
          current instanceof LongString
            ? current.totalLength
            : Array.isArray(current)
              ? current.length
              : text !== null
                ? text.length
                : current !== null && typeof current === "object"
                  ? Object.keys(current as Record<string, unknown>).length
                  : 0;
        break;
      }
    }
  }

  return { kept: true, value: current };
}

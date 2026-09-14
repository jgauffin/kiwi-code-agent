/**
 * Every response is capped, and a capped response says so. A partial answer that
 * looks complete is worse than an error, so truncation is always reported with a
 * count of what was left out, and clipped strings carry their true length.
 */

import { LongString } from "./scanner.js";

/** Ceiling on the JSON text a single tool call may return. */
export const MAX_RESPONSE_BYTES = 32 * 1024;

export interface Truncation {
  reason: "limit" | "response_bytes";
  rows_omitted: number;
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

/**
 * Replace long strings with a self-describing marker so the caller can see both
 * what the value starts with and how much of it is missing.
 */
export function clipStrings(value: unknown, maxString: number): unknown {
  if (value instanceof LongString) {
    return clipText(value.text, value.totalLength, maxString);
  }
  if (typeof value === "string") {
    return value.length > maxString ? clipText(value, value.length, maxString) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clipStrings(item, maxString));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = clipStrings(child, maxString);
    }
    return out;
  }
  return value;
}

function clipText(text: string, totalLength: number, maxString: number): string {
  return `${text.slice(0, maxString)}...[len=${totalLength}]`;
}

/**
 * Keep rows while they fit the byte budget. The first row is always kept, so a
 * single oversized row is reported as one row rather than as an empty result.
 */
export function fitRows<T>(rows: readonly T[], budgetBytes: number): { kept: T[]; omitted: number } {
  const kept: T[] = [];
  let used = 0;

  for (const row of rows) {
    const size = byteLength(row) + 2;
    if (kept.length > 0 && used + size > budgetBytes) break;
    kept.push(row);
    used += size;
  }

  return { kept, omitted: rows.length - kept.length };
}

/** The truncation field carried by every row-returning response. */
export function describeTruncation(
  omittedByLimit: number,
  omittedByBytes: number,
): Truncation | null {
  if (omittedByBytes > 0) {
    return { reason: "response_bytes", rows_omitted: omittedByBytes + omittedByLimit };
  }
  if (omittedByLimit > 0) {
    return { reason: "limit", rows_omitted: omittedByLimit };
  }
  return null;
}

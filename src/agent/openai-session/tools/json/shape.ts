/**
 * Structural summary of a file: key names, value types, array lengths, nesting.
 * Array lengths are counted from the token stream, so a summary of a file with a
 * million records costs the same as one with ten.
 */

import { LongString } from "./scanner.js";
import type { Token } from "./scanner.js";
import { clipStrings } from "./output.js";

/** Array elements whose shape is merged into `items`. The rest are only counted. */
export const SAMPLE_ITEMS = 20;

/** Length of the example values reported for leaves. */
export const SAMPLE_STRING_LENGTH = 60;

interface ShapeNode {
  types: Set<string>;
  /** How many values were seen at this position. */
  count: number;
  /** How many of those were objects, so optional keys can be spotted. */
  objectCount: number;
  sample?: unknown;
  hasSample: boolean;
  keys: Map<string, ShapeNode>;
  items?: ShapeNode;
  arrayCount: number;
  minLength: number;
  maxLength: number;
  itemsSampled: boolean;
  depthTruncated: boolean;
}

interface Frame {
  node: ShapeNode | null;
  kind: "object" | "array";
  index: number;
  key: string | null;
}

function newNode(): ShapeNode {
  return {
    types: new Set(),
    count: 0,
    objectCount: 0,
    hasSample: false,
    keys: new Map(),
    arrayCount: 0,
    minLength: Number.POSITIVE_INFINITY,
    maxLength: 0,
    itemsSampled: false,
    depthTruncated: false,
  };
}

export class ShapeBuilder {
  private readonly root = newNode();
  private readonly frames: Frame[] = [];

  constructor(private readonly depthLimit: number) {}

  handle(token: Token): void {
    switch (token.t) {
      case "key": {
        const frame = this.frames[this.frames.length - 1];
        if (frame) frame.key = token.name;
        return;
      }

      case "value": {
        const node = this.target();
        if (node) this.recordScalar(node, token.value);
        return;
      }

      case "startObject": {
        const node = this.target();
        if (node) {
          node.types.add("object");
          node.objectCount++;
        }
        this.frames.push({ node, kind: "object", index: 0, key: null });
        return;
      }

      case "startArray": {
        const node = this.target();
        if (node) node.types.add("array");
        this.frames.push({ node, kind: "array", index: 0, key: null });
        return;
      }

      case "endObject":
      case "endArray": {
        const frame = this.frames.pop();
        if (frame && frame.kind === "array" && frame.node) {
          frame.node.arrayCount++;
          frame.node.minLength = Math.min(frame.node.minLength, frame.index);
          frame.node.maxLength = Math.max(frame.node.maxLength, frame.index);
          if (frame.index > SAMPLE_ITEMS) frame.node.itemsSampled = true;
        }
        return;
      }
    }
  }

  /**
   * The node that records the value now starting, or null when this position is
   * past the depth limit or past the number of array elements being sampled.
   */
  private target(): ShapeNode | null {
    const parent = this.frames[this.frames.length - 1];
    if (!parent) {
      this.root.count++;
      return this.root;
    }

    if (this.frames.length > this.depthLimit) {
      if (parent.node) parent.node.depthTruncated = true;
      if (parent.kind === "array") parent.index++;
      return null;
    }

    if (parent.kind === "array") {
      const index = parent.index++;
      if (!parent.node || index >= SAMPLE_ITEMS) return null;
      const items = parent.node.items ?? newNode();
      parent.node.items = items;
      items.count++;
      return items;
    }

    if (!parent.node) return null;
    const key = parent.key ?? "";
    const existing = parent.node.keys.get(key) ?? newNode();
    parent.node.keys.set(key, existing);
    existing.count++;
    return existing;
  }

  private recordScalar(node: ShapeNode, value: unknown): void {
    if (value === null) {
      node.types.add("null");
    } else if (value instanceof LongString) {
      node.types.add("string");
      if (!node.hasSample) {
        node.sample = value;
        node.hasSample = true;
      }
      return;
    } else {
      node.types.add(typeof value);
    }

    if (!node.hasSample && value !== null) {
      node.sample = value;
      node.hasSample = true;
    }
  }

  /** Render the collected shape, stopping at `maxDepth` levels. */
  render(maxDepth: number, withSamples: boolean): unknown {
    return renderNode(this.root, this.root.count, maxDepth, withSamples);
  }
}

function renderNode(
  node: ShapeNode,
  parentCount: number,
  remainingDepth: number,
  withSamples: boolean,
): unknown {
  const out: Record<string, unknown> = {
    type: node.types.size > 0 ? [...node.types].join("|") : "unknown",
  };

  if (node.count < parentCount) out.optional = true;

  if (node.types.has("array")) {
    if (node.arrayCount === 1) {
      out.length = node.maxLength;
    } else if (node.arrayCount > 1) {
      out.length =
        node.minLength === node.maxLength
          ? node.maxLength
          : { min: node.minLength, max: node.maxLength };
      out.arrays = node.arrayCount;
    }
    if (node.itemsSampled) out.items_sampled = SAMPLE_ITEMS;
  }

  // Either the walk stopped recording below here, or this render is stopping.
  if (node.depthTruncated || (remainingDepth <= 0 && (node.keys.size > 0 || node.items))) {
    out.truncated = "depth";
  }

  if (remainingDepth > 0) {
    if (node.items) {
      out.items = renderNode(node.items, node.items.count, remainingDepth - 1, withSamples);
    }
    if (node.keys.size > 0) {
      const keys: Record<string, unknown> = {};
      for (const [name, child] of node.keys) {
        keys[name] = renderNode(child, node.objectCount, remainingDepth - 1, withSamples);
      }
      out.keys = keys;
    }
  }

  if (withSamples && node.hasSample) {
    out.sample = clipStrings(node.sample, SAMPLE_STRING_LENGTH);
  }

  return out;
}

import type { JsonValue } from "../contracts/json.ts";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

const encoder = new TextEncoder();

function encode(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  const fields = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(value[key]!)}`);
  return `{${fields.join(",")}}`;
}

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
  return encoder.encode(encode(value));
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertDepth(value: unknown, maximum: number): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > maximum) throw new SyntaxError(`JSON depth exceeds limit ${maximum}`);
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (typeof current.value === "object" && current.value !== null) {
      for (const child of Object.values(current.value))
        pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

export interface JsonReadLimits {
  maxBytes?: number;
  maxDepth?: number;
}

export function parseJsonBytes(
  data: Uint8Array,
  label: string,
  limits: JsonReadLimits = {},
): JsonValue {
  const maximum = limits.maxBytes ?? 64 * 1024 * 1024;
  if (data.byteLength > maximum)
    throw new SyntaxError(`${label} size limit exceeded (maximum ${maximum} bytes)`);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    throw new SyntaxError(`${label} is not valid UTF-8 JSON: ${String(error)}`);
  }
  assertDepth(value, limits.maxDepth ?? 128);
  return value as JsonValue;
}

export function readBoundedBytes(path: string, maximum: number): Uint8Array {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`${path} is not a regular file`);
    if (metadata.size > maximum)
      throw new Error(`${path} size limit exceeded (maximum ${maximum} bytes)`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximum) {
      const output = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - total));
      const count = readSync(descriptor, output, 0, output.length, null);
      if (count === 0) break;
      chunks.push(output.subarray(0, count));
      total += count;
    }
    if (total > maximum) throw new Error(`${path} size limit exceeded (maximum ${maximum} bytes)`);
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

export function readCanonicalObject(
  path: string,
  label: string,
  limits: JsonReadLimits = {},
): Record<string, JsonValue> {
  const data = readBoundedBytes(path, limits.maxBytes ?? 64 * 1024 * 1024);
  const value = parseJsonBytes(data, label, limits);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SyntaxError(`${label} must contain a JSON object`);
  }
  if (!Buffer.from(data).equals(Buffer.from(canonicalJsonBytes(value)))) {
    throw new SyntaxError(`${label} is not canonical JSON`);
  }
  return value;
}

export function normalizeJson(value: unknown, label: string): JsonValue {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} is not JSON: ${String(error)}`);
  }
  if (encoded === undefined) throw new TypeError(`${label} is not JSON`);
  const normalized = parseJsonBytes(encoder.encode(encoded), label);
  canonicalJsonBytes(normalized);
  return normalized;
}

/**
 * Deep copy, so a caller can hand a stored value to a mutator without the mutation reaching back
 * into the record it came from. Structured clone rather than a JSON round-trip: the round-trip
 * silently drops keys whose value is `undefined`, which turns an ill-formed record into a
 * well-formed one on the way past instead of leaving it to be rejected.
 */
export function jsonCopy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Deep-equal by canonical byte comparison, so key order never causes a false mismatch. The single
 * comparator behind every "did this actually change" check in the store and the graph layer.
 */
export function sameJson(left: unknown, right: unknown): boolean {
  return Buffer.from(canonicalJsonBytes(normalizeJson(left, "left value"))).equals(
    Buffer.from(canonicalJsonBytes(normalizeJson(right, "right value"))),
  );
}

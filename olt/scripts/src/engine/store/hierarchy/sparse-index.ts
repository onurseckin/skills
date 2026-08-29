import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonValue } from "../../../core/contracts/json.ts";
import { atomicWriteJson } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { streamEventLines } from "../events/event-lines.ts";
import { limits } from "../layout/constants.ts";

export const DEFAULT_SPARSE_INDEX_INTERVAL = 100;
export const SPARSE_INDEX_VERSION = 1;

export interface EventSparseIndex {
  readonly version: 1;
  readonly byte_offsets: Readonly<Record<string, number>>;
  readonly indexed_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAndFreezeOffsets(
  rawOffsets: unknown,
  filePath: string,
): Readonly<Record<string, number>> {
  if (!isRecord(rawOffsets)) {
    throw new HarnessError("INTEGRITY", `Invalid byte_offsets map in sparse index "${filePath}"`);
  }
  const validated: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawOffsets)) {
    const seq = Number(key);
    if (!Number.isInteger(seq) || seq < 1 || String(seq) !== key) {
      throw new HarnessError(
        "INTEGRITY",
        `Invalid sequence key "${key}" in byte_offsets in "${filePath}"`,
      );
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new HarnessError(
        "INTEGRITY",
        `Invalid byte offset value for sequence ${key} in "${filePath}": ${String(value)}`,
      );
    }
    validated[key] = value;
  }
  return Object.freeze(validated);
}

/**
 * Loads and validates an EventSparseIndex from disk. Returns null if missing.
 */
export function loadSparseIndex(sparseIndexPath: string): EventSparseIndex | null {
  if (typeof sparseIndexPath !== "string" || !sparseIndexPath.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "sparseIndexPath must be a non-empty string");
  }
  if (!existsSync(sparseIndexPath)) return null;

  let rawContent: string;
  try {
    rawContent = readFileSync(sparseIndexPath, "utf-8");
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `Failed to read sparse index at "${sparseIndexPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `Corrupted sparse index JSON in "${sparseIndexPath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new HarnessError(
      "INTEGRITY",
      `Sparse index content must be a JSON object in "${sparseIndexPath}"`,
    );
  }

  const { version, byte_offsets, indexed_at } = parsed;
  if (version !== SPARSE_INDEX_VERSION) {
    throw new HarnessError(
      "INTEGRITY",
      `Invalid sparse index version in "${sparseIndexPath}": expected ${SPARSE_INDEX_VERSION}, found ${String(version)}`,
    );
  }
  if (
    typeof indexed_at !== "string" ||
    indexed_at.trim().length === 0 ||
    Number.isNaN(Date.parse(indexed_at))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `Invalid indexed_at timestamp in "${sparseIndexPath}": "${String(indexed_at)}"`,
    );
  }

  return {
    version: 1,
    byte_offsets: validateAndFreezeOffsets(byte_offsets, sparseIndexPath),
    indexed_at,
  };
}

/**
 * Updates sparse index for sequence/byteOffset. Returns updated index or null if not indexed.
 */
export function updateSparseIndex(
  sparseIndexPath: string,
  sequence: number,
  byteOffset: number,
  interval = DEFAULT_SPARSE_INDEX_INTERVAL,
): EventSparseIndex | null {
  if (typeof sparseIndexPath !== "string" || !sparseIndexPath.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "sparseIndexPath must be a non-empty string");
  }
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Sequence must be a positive integer: ${String(sequence)}`,
    );
  }
  if (typeof byteOffset !== "number" || !Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Byte offset must be a non-negative integer: ${String(byteOffset)}`,
    );
  }
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Interval must be a positive integer: ${String(interval)}`,
    );
  }

  if (sequence !== 1 && sequence % interval !== 0) return null;

  const existing = loadSparseIndex(sparseIndexPath);
  const updatedOffsets: Record<string, number> = existing
    ? { ...existing.byte_offsets, [String(sequence)]: byteOffset }
    : { [String(sequence)]: byteOffset };

  const updatedIndex: EventSparseIndex = {
    version: 1,
    byte_offsets: Object.freeze(updatedOffsets),
    indexed_at: new Date().toISOString(),
  };

  mkdirSync(dirname(sparseIndexPath), { recursive: true });
  atomicWriteJson(sparseIndexPath, updatedIndex as unknown as JsonValue);
  return updatedIndex;
}

/**
 * Fast O(1) in-memory lookup. Finds greatest indexed sequence S <= targetSequence.
 */
export function seekEventByteOffset(
  sparseIndex: EventSparseIndex | null,
  targetSequence: number,
  interval = DEFAULT_SPARSE_INDEX_INTERVAL,
): number {
  if (sparseIndex === null || !sparseIndex.byte_offsets) return 0;
  if (
    typeof targetSequence !== "number" ||
    !Number.isInteger(targetSequence) ||
    targetSequence < 1
  ) {
    return 0;
  }

  const intv =
    typeof interval === "number" && Number.isInteger(interval) && interval > 0
      ? interval
      : DEFAULT_SPARSE_INDEX_INTERVAL;

  let candidate = Math.floor(targetSequence / intv) * intv;
  while (candidate >= intv) {
    const offset = sparseIndex.byte_offsets[String(candidate)];
    if (typeof offset === "number" && offset >= 0) return offset;
    candidate -= intv;
  }

  if (targetSequence >= 1) {
    const seq1Offset = sparseIndex.byte_offsets["1"];
    if (typeof seq1Offset === "number" && seq1Offset >= 0) return seq1Offset;
  }
  return 0;
}

/**
 * Streams/reads events.jsonl, computing exact byte offsets at line boundaries.
 */
export function rebuildSparseIndex(
  eventsPath: string,
  sparseIndexPath: string,
  interval = DEFAULT_SPARSE_INDEX_INTERVAL,
): EventSparseIndex {
  if (typeof eventsPath !== "string" || !eventsPath.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "eventsPath must be a non-empty string");
  }
  if (typeof sparseIndexPath !== "string" || !sparseIndexPath.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "sparseIndexPath must be a non-empty string");
  }
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Interval must be a positive integer: ${String(interval)}`,
    );
  }
  if (!existsSync(eventsPath)) {
    throw new HarnessError("NOT_FOUND", `Events file not found: "${eventsPath}"`);
  }

  const byteOffsets: Record<string, number> = {};
  let currentOffset = 0;
  const storeLimits = limits();

  for (const line of streamEventLines(
    eventsPath,
    storeLimits.maxEventBytes,
    storeLimits.maxEventLogBytes,
  )) {
    const lineStartOffset = currentOffset;
    currentOffset = line.endOffset;

    if (!line.terminated) {
      throw new HarnessError("INTEGRITY", `Torn final line in events file "${eventsPath}"`);
    }
    if (line.oversized) {
      throw new HarnessError(
        "INTEGRITY",
        `Event line ${line.index} exceeds max size in "${eventsPath}"`,
      );
    }

    const rawStr = Buffer.from(line.content).toString("utf-8").trim();
    if (rawStr.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawStr);
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `Invalid JSON on line ${line.index} in "${eventsPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(parsed)) {
      throw new HarnessError(
        "INTEGRITY",
        `Event on line ${line.index} is not an object in "${eventsPath}"`,
      );
    }

    const seq = parsed.sequence;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new HarnessError(
        "INTEGRITY",
        `Invalid event sequence on line ${line.index} in "${eventsPath}": ${String(seq)}`,
      );
    }
    if (seq === 1 || seq % interval === 0) {
      byteOffsets[String(seq)] = lineStartOffset;
    }
  }

  const sparseIndex: EventSparseIndex = {
    version: 1,
    byte_offsets: Object.freeze(byteOffsets),
    indexed_at: new Date().toISOString(),
  };

  mkdirSync(dirname(sparseIndexPath), { recursive: true });
  atomicWriteJson(sparseIndexPath, sparseIndex as unknown as JsonValue);
  return sparseIndex;
}

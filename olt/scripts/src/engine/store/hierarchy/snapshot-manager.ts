import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "../../../core/contracts/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../core/json.ts";

export interface SnapshotRecord {
  readonly sequence: number;
  readonly snapshot_sha256: string;
  readonly created_at: string;
  readonly state_payload: Record<string, unknown>;
}

const STATE_FILE_REGEX = /^state\.(\d+)\.json$/;

export function shouldCreateSnapshot(sequence: number, interval = 200): boolean {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    return false;
  }
  if (!Number.isInteger(interval) || interval <= 0) {
    return false;
  }
  return sequence % interval === 0;
}

function computeStatePayloadHash(payload: Record<string, unknown>): string {
  return sha256Bytes(canonicalJsonBytes(payload as unknown as JsonValue));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAndValidateSnapshot(
  content: string,
  filePath: string,
  expectedSequence?: number,
): SnapshotRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `Corrupted snapshot JSON in "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new HarnessError("INTEGRITY", `Snapshot content must be a JSON object in "${filePath}"`);
  }

  const { sequence, snapshot_sha256, created_at, state_payload } = parsed;

  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 0) {
    throw new HarnessError("INTEGRITY", `Invalid sequence number in snapshot "${filePath}"`);
  }

  if (expectedSequence !== undefined && sequence !== expectedSequence) {
    throw new HarnessError(
      "INTEGRITY",
      `Sequence mismatch in snapshot "${filePath}": expected ${expectedSequence}, found ${sequence}`,
    );
  }

  if (typeof snapshot_sha256 !== "string" || snapshot_sha256.trim().length === 0) {
    throw new HarnessError("INTEGRITY", `Invalid snapshot_sha256 in snapshot "${filePath}"`);
  }

  if (typeof created_at !== "string" || created_at.trim().length === 0) {
    throw new HarnessError("INTEGRITY", `Invalid created_at timestamp in snapshot "${filePath}"`);
  }

  if (!isRecord(state_payload)) {
    throw new HarnessError("INTEGRITY", `Invalid state_payload in snapshot "${filePath}"`);
  }

  let computedHash: string;
  try {
    computedHash = computeStatePayloadHash(state_payload);
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `Failed to serialize state_payload in "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (computedHash !== snapshot_sha256) {
    throw new HarnessError(
      "INTEGRITY",
      `Snapshot SHA-256 hash mismatch in "${filePath}": expected ${snapshot_sha256}, computed ${computedHash}`,
    );
  }

  return {
    sequence,
    snapshot_sha256,
    created_at,
    state_payload: structuredClone(state_payload),
  };
}

export function writeAtomicSnapshot(
  snapshotsDir: string,
  sequence: number,
  statePayload: Record<string, unknown>,
): SnapshotRecord {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Sequence must be a non-negative integer: ${sequence}`,
    );
  }
  if (!isRecord(statePayload)) {
    throw new HarnessError("INVALID_ARGUMENT", "statePayload must be a non-null object");
  }

  const snapshotSha256 = computeStatePayloadHash(statePayload);
  const snapshot: SnapshotRecord = {
    sequence,
    snapshot_sha256: snapshotSha256,
    created_at: new Date().toISOString(),
    state_payload: structuredClone(statePayload),
  };

  mkdirSync(snapshotsDir, { recursive: true });

  const unique = randomUUID();
  const tempPath = join(snapshotsDir, `.tmp.state.${sequence}.${unique}.json`);
  const targetPath = join(snapshotsDir, `state.${sequence}.json`);

  const serialized = canonicalJsonBytes(snapshot as unknown as JsonValue);

  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    let offset = 0;
    while (offset < serialized.byteLength) {
      offset += writeSync(descriptor, serialized, offset, serialized.byteLength - offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, targetPath);

    try {
      const dirDescriptor = openSync(
        snapshotsDir,
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
      );
      try {
        fsyncSync(dirDescriptor);
      } finally {
        closeSync(dirDescriptor);
      }
    } catch {}
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (existsSync(tempPath)) {
      try {
        rmSync(tempPath, { force: true });
      } catch {}
    }
    throw error;
  }

  return snapshot;
}

export function loadSnapshotAtSequence(
  snapshotsDir: string,
  sequence: number,
): SnapshotRecord | null {
  const filePath = join(snapshotsDir, `state.${sequence}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, "utf-8");
  return parseAndValidateSnapshot(raw, filePath, sequence);
}

export function loadLatestSnapshot(
  snapshotsDir: string,
  maxSequence?: number,
): SnapshotRecord | null {
  if (!existsSync(snapshotsDir)) {
    return null;
  }

  const limit = maxSequence ?? Number.POSITIVE_INFINITY;
  const entries = readdirSync(snapshotsDir);
  const matchedSequences: number[] = [];

  for (const entry of entries) {
    const match = STATE_FILE_REGEX.exec(entry);
    if (match && match[1] !== undefined) {
      const seq = Number.parseInt(match[1], 10);
      if (Number.isInteger(seq) && seq <= limit) {
        matchedSequences.push(seq);
      }
    }
  }

  if (matchedSequences.length === 0) {
    return null;
  }

  matchedSequences.sort((a, b) => b - a);
  const highestSeq = matchedSequences[0]!;

  return loadSnapshotAtSequence(snapshotsDir, highestSeq);
}

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { writeAtomicSnapshot, type SnapshotRecord } from "./snapshot-manager.ts";

export interface CheckpointMetrics {
  readonly sequence: number;
  readonly accumulatedDeltaBytes?: number;
  readonly isTerminal?: boolean;
  readonly forceCheckpoint?: boolean;
}

export interface CheckpointPolicy {
  readonly intervalSequences?: number;
  readonly maxAccumulatedBytes?: number;
  readonly checkpointOnTerminal?: boolean;
}

export interface CheckpointRetentionOptions {
  readonly retainCount?: number;
  readonly minRetainedSequence?: number;
}

export interface PruneCheckpointsResult {
  readonly totalFound: number;
  readonly prunedCount: number;
  readonly retainedSequences: readonly number[];
  readonly prunedSequences: readonly number[];
}

const STATE_FILE_REGEX = /^state\.(\d+)\.json$/;

export function shouldTriggerCheckpoint(
  metrics: CheckpointMetrics,
  policy: CheckpointPolicy = {},
): boolean {
  if (!metrics || typeof metrics.sequence !== "number" || metrics.sequence < 1) {
    return false;
  }
  if (metrics.forceCheckpoint) {
    return true;
  }
  if (policy.checkpointOnTerminal !== false && metrics.isTerminal) {
    return true;
  }

  const interval = policy.intervalSequences ?? 200;
  if (interval > 0 && metrics.sequence % interval === 0) {
    return true;
  }

  const maxBytes = policy.maxAccumulatedBytes;
  if (
    maxBytes !== undefined &&
    typeof metrics.accumulatedDeltaBytes === "number" &&
    metrics.accumulatedDeltaBytes >= maxBytes
  ) {
    return true;
  }

  return false;
}

export function createStateCheckpoint(
  snapshotsDir: string,
  sequence: number,
  statePayload: Record<string, unknown>,
): SnapshotRecord {
  if (!snapshotsDir || typeof snapshotsDir !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "snapshotsDir must be a non-empty string");
  }
  return writeAtomicSnapshot(snapshotsDir, sequence, statePayload);
}

export function pruneExpiredCheckpoints(
  snapshotsDir: string,
  options: CheckpointRetentionOptions = {},
): PruneCheckpointsResult {
  if (!snapshotsDir || typeof snapshotsDir !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "snapshotsDir must be a non-empty string");
  }
  if (!existsSync(snapshotsDir)) {
    return {
      totalFound: 0,
      prunedCount: 0,
      retainedSequences: [],
      prunedSequences: [],
    };
  }

  const retainCount = options.retainCount ?? 5;
  const minRetained = options.minRetainedSequence;

  const entries = readdirSync(snapshotsDir);
  const foundMap = new Map<number, string>();

  for (const entry of entries) {
    const match = STATE_FILE_REGEX.exec(entry);
    if (match && match[1] !== undefined) {
      const seq = Number.parseInt(match[1], 10);
      if (Number.isInteger(seq)) {
        foundMap.set(seq, entry);
      }
    }
  }

  const allSequences = Array.from(foundMap.keys()).sort((a, b) => b - a);
  const totalFound = allSequences.length;

  const retainedSequences: number[] = [];
  const prunedSequences: number[] = [];

  for (let i = 0; i < allSequences.length; i++) {
    const seq = allSequences[i]!;
    const keepByCount = retainedSequences.length < retainCount;
    const keepByMinSeq = minRetained !== undefined && seq >= minRetained;

    if (keepByCount || keepByMinSeq) {
      retainedSequences.push(seq);
    } else {
      prunedSequences.push(seq);
    }
  }

  for (const seq of prunedSequences) {
    const fileName = foundMap.get(seq);
    if (fileName) {
      const filePath = join(snapshotsDir, fileName);
      try {
        rmSync(filePath, { force: true });
      } catch {}
    }
  }

  return {
    totalFound,
    prunedCount: prunedSequences.length,
    retainedSequences: Object.freeze(retainedSequences.sort((a, b) => a - b)),
    prunedSequences: Object.freeze(prunedSequences.sort((a, b) => a - b)),
  };
}

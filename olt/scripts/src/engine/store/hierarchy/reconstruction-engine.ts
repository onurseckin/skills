import { closeSync, constants, existsSync, openSync, readSync } from "node:fs";
import type { JsonObject, ProjectionPatchOp } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type { CapsulePaths } from "./storage-paths.ts";
import { loadLatestSnapshot } from "./snapshot-manager.ts";
import { loadSparseIndex, seekEventByteOffset } from "./sparse-index.ts";
import { applyProjectionPatch } from "../projections/projection-patch.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ParsedEventLine {
  readonly sequence: number;
  readonly raw: Record<string, unknown>;
}

function* streamEventsFromOffset(
  eventsPath: string,
  startOffset: number,
): Generator<ParsedEventLine> {
  const descriptor = openSync(eventsPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let remainder = "";
    let filePos = startOffset;

    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, filePos);
      if (count === 0) break;
      filePos += count;

      const text = remainder + buffer.subarray(0, count).toString("utf-8");
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch (error) {
          throw new HarnessError(
            "INTEGRITY",
            `Corrupted event JSON in "${eventsPath}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!isRecord(parsed)) {
          throw new HarnessError(
            "INTEGRITY",
            `Event line must be a JSON object in "${eventsPath}"`,
          );
        }
        const seq = parsed.sequence;
        if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
          throw new HarnessError(
            "INTEGRITY",
            `Invalid event sequence in "${eventsPath}": ${String(seq)}`,
          );
        }
        yield { sequence: seq, raw: parsed };
      }
    }

    if (remainder.trim().length > 0) {
      const trimmed = remainder.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        throw new HarnessError(
          "INTEGRITY",
          `Corrupted trailing event JSON in "${eventsPath}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!isRecord(parsed)) {
        throw new HarnessError("INTEGRITY", `Event line must be a JSON object in "${eventsPath}"`);
      }
      const seq = parsed.sequence;
      if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
        throw new HarnessError(
          "INTEGRITY",
          `Invalid event sequence in "${eventsPath}": ${String(seq)}`,
        );
      }
      yield { sequence: seq, raw: parsed };
    }
  } finally {
    closeSync(descriptor);
  }
}

export function fastForwardProjection(
  currentState: Record<string, unknown>,
  fromSequence: number,
  toSequence: number,
  capsulePaths: CapsulePaths,
): Record<string, unknown> {
  if (!isRecord(currentState)) {
    throw new HarnessError("INVALID_ARGUMENT", "currentState must be a non-null object");
  }
  if (typeof fromSequence !== "number" || !Number.isInteger(fromSequence) || fromSequence < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `fromSequence must be a non-negative integer: ${String(fromSequence)}`,
    );
  }
  if (typeof toSequence !== "number" || !Number.isInteger(toSequence) || toSequence < 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `toSequence must be a non-negative integer: ${String(toSequence)}`,
    );
  }
  if (toSequence < fromSequence) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `toSequence (${toSequence}) must be >= fromSequence (${fromSequence})`,
    );
  }
  if (
    !capsulePaths ||
    typeof capsulePaths.eventsPath !== "string" ||
    !capsulePaths.eventsPath.trim()
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "capsulePaths.eventsPath must be a non-empty string",
    );
  }

  if (fromSequence === toSequence) {
    return structuredClone(currentState);
  }

  if (!existsSync(capsulePaths.eventsPath)) {
    throw new HarnessError("NOT_FOUND", `Events file not found: "${capsulePaths.eventsPath}"`);
  }

  const startSeq = fromSequence + 1;
  const sparseIndex = capsulePaths.sparseIndexPath
    ? loadSparseIndex(capsulePaths.sparseIndexPath)
    : null;
  const seekOffset = seekEventByteOffset(sparseIndex, startSeq);

  let state: Record<string, unknown> = structuredClone(currentState);
  let expectedSeq = startSeq;
  let reachedTarget = false;

  for (const { sequence, raw } of streamEventsFromOffset(capsulePaths.eventsPath, seekOffset)) {
    if (sequence < startSeq) {
      continue;
    }

    if (sequence !== expectedSeq) {
      throw new HarnessError(
        "INTEGRITY",
        `Event sequence gap in "${capsulePaths.eventsPath}": expected ${expectedSeq}, found ${sequence}`,
      );
    }

    if (raw.projection !== null && raw.projection !== undefined) {
      if (!isRecord(raw.projection)) {
        throw new HarnessError(
          "INTEGRITY",
          `Event sequence ${sequence} projection must be a JSON object in "${capsulePaths.eventsPath}"`,
        );
      }
      state = structuredClone(raw.projection);
    } else if (raw.projection_patch !== null && raw.projection_patch !== undefined) {
      if (!Array.isArray(raw.projection_patch)) {
        throw new HarnessError(
          "INTEGRITY",
          `Event sequence ${sequence} projection_patch must be an array in "${capsulePaths.eventsPath}"`,
        );
      }
      state = applyProjectionPatch(
        state as JsonObject,
        raw.projection_patch as readonly ProjectionPatchOp[],
      );
    }

    expectedSeq += 1;

    if (sequence === toSequence) {
      reachedTarget = true;
      break;
    }
  }

  if (!reachedTarget) {
    throw new HarnessError(
      "NOT_FOUND",
      `Target sequence ${toSequence} exceeds maximum event sequence ${expectedSeq - 1} in "${capsulePaths.eventsPath}"`,
    );
  }

  return state;
}

export function reconstructStateAtSequence(
  capsulePaths: CapsulePaths,
  targetSequence: number,
): Record<string, unknown> {
  if (
    !capsulePaths ||
    typeof capsulePaths.snapshotsDir !== "string" ||
    !capsulePaths.snapshotsDir.trim()
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "capsulePaths.snapshotsDir must be a non-empty string",
    );
  }
  if (
    typeof targetSequence !== "number" ||
    !Number.isInteger(targetSequence) ||
    targetSequence < 0
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `targetSequence must be a non-negative integer: ${String(targetSequence)}`,
    );
  }

  if (targetSequence === 0) {
    return {};
  }

  const snapshot = loadLatestSnapshot(capsulePaths.snapshotsDir, targetSequence);

  if (snapshot !== null) {
    const baseSeq = snapshot.sequence;
    if (baseSeq === targetSequence) {
      return structuredClone(snapshot.state_payload);
    }
    return fastForwardProjection(snapshot.state_payload, baseSeq, targetSequence, capsulePaths);
  }

  return fastForwardProjection({}, 0, targetSequence, capsulePaths);
}

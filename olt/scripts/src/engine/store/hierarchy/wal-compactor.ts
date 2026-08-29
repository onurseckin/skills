import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { loadLatestSnapshot } from "./snapshot-manager.ts";
import { rebuildSparseIndex } from "./sparse-index.ts";
import type { CapsulePaths } from "./storage-paths.ts";

export interface WalCompactionOptions {
  readonly upToSequence?: number;
  readonly archiveHistoricalEvents?: boolean;
  readonly customArchiveDir?: string;
}

export interface WalCompactionResult {
  readonly success: boolean;
  readonly baseSnapshotSequence: number;
  readonly originalEventsCount: number;
  readonly retainedEventsCount: number;
  readonly prunedEventsCount: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly compressionRatio: number;
  readonly archivedPath?: string | undefined;
}

interface RawEventRecord {
  readonly sequence: number;
  readonly raw: string;
}

function parseEventLines(eventsPath: string): RawEventRecord[] {
  const content = readFileSync(eventsPath, "utf-8");
  const lines = content.split("\n");
  const records: RawEventRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `Corrupted event JSON at line ${i + 1} in "${eventsPath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HarnessError(
        "INTEGRITY",
        `Event line ${i + 1} must be a JSON object in "${eventsPath}"`,
      );
    }

    const seq = (parsed as Record<string, unknown>).sequence;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      throw new HarnessError(
        "INTEGRITY",
        `Invalid event sequence on line ${i + 1} in "${eventsPath}": ${String(seq)}`,
      );
    }

    records.push({ sequence: seq, raw: rawLine });
  }

  return records;
}

function writeAtomicLines(targetPath: string, lines: readonly string[]): void {
  const tempPath = `${targetPath}.${randomUUID()}.tmp`;
  const serialized = Buffer.from(lines.map((l) => `${l}\n`).join(""), "utf-8");

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
}

export function compactWalLog(
  capsulePaths: CapsulePaths,
  options: WalCompactionOptions = {},
): WalCompactionResult {
  if (!capsulePaths || typeof capsulePaths.eventsPath !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "capsulePaths.eventsPath is required");
  }
  if (!existsSync(capsulePaths.eventsPath)) {
    throw new HarnessError("NOT_FOUND", `Events file not found: "${capsulePaths.eventsPath}"`);
  }

  const bytesBefore = statSync(capsulePaths.eventsPath).size;
  const snapshot = loadLatestSnapshot(capsulePaths.snapshotsDir, options.upToSequence);

  if (!snapshot || snapshot.sequence <= 1) {
    return {
      success: true,
      baseSnapshotSequence: snapshot ? snapshot.sequence : 0,
      originalEventsCount: 0,
      retainedEventsCount: 0,
      prunedEventsCount: 0,
      bytesBefore,
      bytesAfter: bytesBefore,
      compressionRatio: 1.0,
    };
  }

  const baseSeq = snapshot.sequence;
  const allEvents = parseEventLines(capsulePaths.eventsPath);
  const originalEventsCount = allEvents.length;

  const preEvents = allEvents.filter((e) => e.sequence < baseSeq);
  const retainedEvents = allEvents.filter((e) => e.sequence >= baseSeq);

  if (preEvents.length === 0) {
    return {
      success: true,
      baseSnapshotSequence: baseSeq,
      originalEventsCount,
      retainedEventsCount: originalEventsCount,
      prunedEventsCount: 0,
      bytesBefore,
      bytesAfter: bytesBefore,
      compressionRatio: 1.0,
    };
  }

  let archivedPath: string | undefined;
  if (options.archiveHistoricalEvents !== false) {
    const archiveDir = options.customArchiveDir ?? join(capsulePaths.runRoot, "archive");
    mkdirSync(archiveDir, { recursive: true });
    const firstSeq = preEvents[0]?.sequence ?? 1;
    const lastSeq = preEvents[preEvents.length - 1]?.sequence ?? baseSeq - 1;
    archivedPath = join(archiveDir, `events.${firstSeq}-${lastSeq}.jsonl`);
    writeFileSync(archivedPath, preEvents.map((e) => `${e.raw}\n`).join(""), "utf-8");
  }

  const retainedLines = retainedEvents.map((e) => e.raw);
  writeAtomicLines(capsulePaths.eventsPath, retainedLines);

  const bytesAfter = statSync(capsulePaths.eventsPath).size;
  const prunedEventsCount = preEvents.length;
  const retainedEventsCount = retainedEvents.length;
  const compressionRatio = bytesBefore > 0 ? Number((bytesAfter / bytesBefore).toFixed(4)) : 1.0;

  if (capsulePaths.sparseIndexPath) {
    rebuildSparseIndex(capsulePaths.eventsPath, capsulePaths.sparseIndexPath);
  }

  return {
    success: true,
    baseSnapshotSequence: baseSeq,
    originalEventsCount,
    retainedEventsCount,
    prunedEventsCount,
    bytesBefore,
    bytesAfter,
    compressionRatio,
    archivedPath,
  };
}

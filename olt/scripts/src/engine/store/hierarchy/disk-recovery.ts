import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { fastForwardProjection } from "./reconstruction-engine.ts";
import { loadSnapshotAtSequence } from "./snapshot-manager.ts";
import { rebuildSparseIndex } from "./sparse-index.ts";
import type { CapsulePaths } from "./storage-paths.ts";

export interface DiskRecoveryOptions {
  readonly targetSequence?: number;
  readonly quarantineTornTail?: boolean;
  readonly rebuildIndexIfMissing?: boolean;
}

export interface DiskRecoveryOutcome {
  readonly recoveredState: Record<string, unknown>;
  readonly baseSnapshotSequence: number;
  readonly replayedEventsCount: number;
  readonly finalSequence: number;
  readonly quarantinedTail: boolean;
  readonly indexRebuilt: boolean;
}

const STATE_FILE_REGEX = /^state\.(\d+)\.json$/;

function findLatestValidSnapshot(
  snapshotsDir: string,
  maxSequence?: number,
): { sequence: number; payload: Record<string, unknown> } | null {
  if (!existsSync(snapshotsDir)) return null;

  const entries = readdirSync(snapshotsDir);
  const candidates: number[] = [];
  const limit = maxSequence ?? Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const match = STATE_FILE_REGEX.exec(entry);
    if (match && match[1] !== undefined) {
      const seq = Number.parseInt(match[1], 10);
      if (Number.isInteger(seq) && seq <= limit) {
        candidates.push(seq);
      }
    }
  }

  candidates.sort((a, b) => b - a);

  for (const seq of candidates) {
    try {
      const snap = loadSnapshotAtSequence(snapshotsDir, seq);
      if (snap) {
        return { sequence: snap.sequence, payload: snap.state_payload };
      }
    } catch {}
  }

  return null;
}

function sanitizeAndFindFinalSequence(
  eventsPath: string,
  runRoot: string,
  quarantine: boolean,
): { finalSequence: number; quarantinedTail: boolean } {
  const content = readFileSync(eventsPath);
  let lastNewlineIndex = -1;

  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i] === 10) {
      lastNewlineIndex = i;
      break;
    }
  }

  let quarantinedTail = false;
  if (lastNewlineIndex < content.length - 1 && content.length > 0) {
    if (quarantine) {
      const tornBytes = content.subarray(lastNewlineIndex + 1);
      const quarantineDir = join(runRoot, "quarantine");
      mkdirSync(quarantineDir, { recursive: true });
      const tornFile = join(quarantineDir, `torn-tail-${Date.now()}.bin`);
      writeFileSync(tornFile, tornBytes);
      truncateSync(eventsPath, lastNewlineIndex + 1);
      quarantinedTail = true;
    }
  }

  const cleanContent = readFileSync(eventsPath, "utf-8");
  const lines = cleanContent.split("\n");
  let maxSeq = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && typeof parsed.sequence === "number") {
        if (parsed.sequence > maxSeq) {
          maxSeq = parsed.sequence;
        }
      }
    } catch {}
  }

  return { finalSequence: maxSeq, quarantinedTail };
}

export function recoverDiskState(
  capsulePaths: CapsulePaths,
  options: DiskRecoveryOptions = {},
): DiskRecoveryOutcome {
  if (!capsulePaths || typeof capsulePaths.eventsPath !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "capsulePaths.eventsPath is required");
  }
  if (!existsSync(capsulePaths.eventsPath)) {
    throw new HarnessError("NOT_FOUND", `Events file not found: "${capsulePaths.eventsPath}"`);
  }

  const quarantine = options.quarantineTornTail !== false;
  const { finalSequence, quarantinedTail } = sanitizeAndFindFinalSequence(
    capsulePaths.eventsPath,
    capsulePaths.runRoot,
    quarantine,
  );

  const targetSeq =
    typeof options.targetSequence === "number" && options.targetSequence <= finalSequence
      ? options.targetSequence
      : finalSequence;

  let indexRebuilt = false;
  if (options.rebuildIndexIfMissing !== false && capsulePaths.sparseIndexPath) {
    if (
      !existsSync(capsulePaths.sparseIndexPath) ||
      statSync(capsulePaths.sparseIndexPath).size === 0
    ) {
      rebuildSparseIndex(capsulePaths.eventsPath, capsulePaths.sparseIndexPath);
      indexRebuilt = true;
    }
  }

  if (targetSeq === 0) {
    return {
      recoveredState: {},
      baseSnapshotSequence: 0,
      replayedEventsCount: 0,
      finalSequence: 0,
      quarantinedTail,
      indexRebuilt,
    };
  }

  const validSnapshot = findLatestValidSnapshot(capsulePaths.snapshotsDir, targetSeq);

  if (validSnapshot) {
    const baseSeq = validSnapshot.sequence;
    if (baseSeq === targetSeq) {
      return {
        recoveredState: structuredClone(validSnapshot.payload),
        baseSnapshotSequence: baseSeq,
        replayedEventsCount: 0,
        finalSequence: targetSeq,
        quarantinedTail,
        indexRebuilt,
      };
    }

    const state = fastForwardProjection(validSnapshot.payload, baseSeq, targetSeq, capsulePaths);

    return {
      recoveredState: state,
      baseSnapshotSequence: baseSeq,
      replayedEventsCount: targetSeq - baseSeq,
      finalSequence: targetSeq,
      quarantinedTail,
      indexRebuilt,
    };
  }

  const state = fastForwardProjection({}, 0, targetSeq, capsulePaths);

  return {
    recoveredState: state,
    baseSnapshotSequence: 0,
    replayedEventsCount: targetSeq,
    finalSequence: targetSeq,
    quarantinedTail,
    indexRebuilt,
  };
}

import { existsSync, readFileSync } from "node:fs";
import {
  parseAndDeduplicateBlunderJsonl,
  serializeAggregatedBlunderLog,
} from "../blunders/index.ts";
import type {
  AggregatedBlunder,
  BlunderRecordInput,
  BlunderResolutionProof,
  LiveDeduplicationOptions,
} from "../blunders/types.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  compactBlunderLogFile,
  readBlunderLogFile,
  recordKeyedBlunder,
} from "../logging/blunder-logger.ts";
import type { BlunderLogOptions } from "../logging/types.ts";
import { resolveBlunder } from "../mind/blunders.ts";
import { runFilePath } from "./paths.ts";

export function appendCapsuleBlunder(
  runRoot: string,
  blunder: BlunderRecordInput,
  options: BlunderLogOptions = {},
): AggregatedBlunder {
  if (!runRoot || typeof runRoot !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot is required to append capsule blunder");
  }

  const blunderPath = runFilePath(runRoot, "blunders.jsonl");
  const result = recordKeyedBlunder(blunder, {
    ...options,
    filePath: blunderPath,
  });

  return result.recorded;
}

export function loadCapsuleBlunders(
  runRoot: string,
  options: LiveDeduplicationOptions = {},
): AggregatedBlunder[] {
  if (!runRoot || typeof runRoot !== "string") {
    return [];
  }

  const blunderPath = runFilePath(runRoot, "blunders.jsonl");
  return readBlunderLogFile(blunderPath, options);
}

export function compactCapsuleBlunders(
  runRoot: string,
  options: LiveDeduplicationOptions = {},
): { totalBefore: number; totalAfter: number } {
  if (!runRoot || typeof runRoot !== "string") {
    return { totalBefore: 0, totalAfter: 0 };
  }

  const blunderPath = runFilePath(runRoot, "blunders.jsonl");
  const res = compactBlunderLogFile(blunderPath, options);
  return { totalBefore: res.totalBefore, totalAfter: res.totalAfter };
}

export function resolveCapsuleBlunder(
  runRoot: string,
  blunderIdOrKey: string,
  proof: BlunderResolutionProof,
): AggregatedBlunder | null {
  if (!runRoot || typeof runRoot !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot is required to resolve capsule blunder");
  }

  const blunderPath = runFilePath(runRoot, "blunders.jsonl");
  if (!existsSync(blunderPath)) {
    return null;
  }

  const entries = loadCapsuleBlunders(runRoot, { strategy: "aggregate_synchronous" });
  const index = entries.findIndex((e) => e.id === blunderIdOrKey || e.dedup_key === blunderIdOrKey);
  if (index < 0) {
    return null;
  }

  const target = entries[index];
  if (!target) {
    return null;
  }

  const resolvedMind = resolveBlunder(target, proof);
  const updated: AggregatedBlunder = {
    ...target,
    status: "resolved",
    resolution: resolvedMind.resolution,
  };
  entries[index] = updated;

  const serialized = serializeAggregatedBlunderLog(entries);
  const encoded = new TextEncoder().encode(serialized);
  atomicWriteBytes(blunderPath, encoded);

  return updated;
}

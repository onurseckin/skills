import { existsSync, readFileSync } from "node:fs";
import {
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
} from "../../mind/defects/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
  DefectResolutionProof,
  LiveDeduplicationOptions,
} from "../../mind/defects/types.ts";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import {
  compactDefectLogFile,
  readDefectLogFile,
  recordKeyedDefect,
} from "../../logging/defect-logger.ts";
import type { DefectLogOptions } from "../../logging/types.ts";
import { resolveDefect } from "../../mind/defects.ts";
import { runFilePath } from "./paths.ts";

export function appendCapsuleDefect(
  runRoot: string,
  defect: DefectRecordInput,
  options: DefectLogOptions = {},
): AggregatedDefect {
  if (!runRoot || typeof runRoot !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot is required to append capsule defect");
  }

  const defectPath = runFilePath(runRoot, "defects.jsonl");
  const result = recordKeyedDefect(defect, {
    ...options,
    filePath: defectPath,
  });

  return result.recorded;
}

export function loadCapsuleDefects(
  runRoot: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  if (!runRoot || typeof runRoot !== "string") {
    return [];
  }

  const defectPath = runFilePath(runRoot, "defects.jsonl");
  return readDefectLogFile(defectPath, options);
}

export function compactCapsuleDefects(
  runRoot: string,
  options: LiveDeduplicationOptions = {},
): { totalBefore: number; totalAfter: number } {
  if (!runRoot || typeof runRoot !== "string") {
    return { totalBefore: 0, totalAfter: 0 };
  }

  const defectPath = runFilePath(runRoot, "defects.jsonl");
  const res = compactDefectLogFile(defectPath, options);
  return { totalBefore: res.totalBefore, totalAfter: res.totalAfter };
}

export function resolveCapsuleDefect(
  runRoot: string,
  defectIdOrKey: string,
  proof: DefectResolutionProof,
): AggregatedDefect | null {
  if (!runRoot || typeof runRoot !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot is required to resolve capsule defect");
  }

  const defectPath = runFilePath(runRoot, "defects.jsonl");
  if (!existsSync(defectPath)) {
    return null;
  }

  const entries = loadCapsuleDefects(runRoot, { strategy: "aggregate_synchronous" });
  const index = entries.findIndex((e) => e.id === defectIdOrKey || e.dedup_key === defectIdOrKey);
  if (index < 0) {
    return null;
  }

  const target = entries[index];
  if (!target) {
    return null;
  }

  const resolvedMind = resolveDefect(target, proof);
  const updated: AggregatedDefect = {
    ...target,
    status: "resolved",
    resolution: resolvedMind.resolution,
  };
  entries[index] = updated;

  const serialized = serializeAggregatedDefectLog(entries);
  const encoded = new TextEncoder().encode(serialized);
  atomicWriteBytes(defectPath, encoded);

  return updated;
}

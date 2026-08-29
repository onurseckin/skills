import { HarnessError } from "../../../core/errors/index.ts";
import {
  compactDefectLogFile,
  readDefectLogFile,
  recordKeyedDefect,
  replaceDefectLogFileUnlocked,
  withDefectLogMutationLock,
} from "../../../logging/defect-logger.ts";
import {
  resolveDefect,
  serializeAggregatedDefectLog,
  type AggregatedDefect,
  type DefectRecordInput,
  type DefectResolutionProof,
} from "../../../logging/defects/index.ts";
import type { DefectLogOptions, LiveDeduplicationOptions } from "../../../logging/types.ts";
import { runFilePath } from "../capsule/paths.ts";

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
  return withDefectLogMutationLock(defectPath, () => {
    const entries = readDefectLogFile(defectPath, { strategy: "aggregate_synchronous" });
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
    replaceDefectLogFileUnlocked(defectPath, serializeAggregatedDefectLog(entries));
    return updated;
  });
}

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeDefectDiscriminator } from "../mind/defects/discriminator.ts";
import type { AggregatedDefect, DefectRecordInput } from "../mind/defects/types.ts";
import { resolveDefectsPath } from "../core/shared/paths.ts";
import type {
  DefectLogOptions,
  DefectLogResult,
  StrictDefectLedgerEntry,
  DefectPromotionPersistenceStage,
  LiveDeduplicationOptions,
} from "./types.ts";
import {
  getDefectLogDependencies,
  hasOwnFilesystemCode,
  replaceDefectLogFileUnlocked,
  setDefectLogDependenciesForTesting,
  throwDefectLogIntegrityError,
  withDefectLogMutationLock,
} from "./lock.ts";
import {
  appendDefectLedgerRecord,
  pruneDefectLedgerRecords,
  withDefectLedgerTransaction,
} from "./transaction.ts";
import {
  __setDefectPromotionPersistenceTestHook,
  promoteDefectLedgerRecords,
  recoverDefectPromotion,
} from "./promotion.ts";
import {
  aggregateDefectEntries,
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
} from "./dedup.ts";

export function resolveDefectLogPath(options: DefectLogOptions = {}): string | null {
  if (options.filePath) {
    return resolve(options.filePath);
  }
  if (options.runRoot) {
    return join(resolve(options.runRoot), "defects.jsonl");
  }
  if (options.targetDir) {
    return join(resolve(options.targetDir), "defects.jsonl");
  }
  return resolveDefectsPath(options.cwd);
}

export function readDefectLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): AggregatedDefect[] {
  try {
    const deps = getDefectLogDependencies();
    const content = deps.readFile(filePath, "utf-8");
    return parseAndDeduplicateDefectJsonl(content, options);
  } catch (error) {
    if (hasOwnFilesystemCode(error, "ENOENT")) {
      return [];
    }
    throwDefectLogIntegrityError("read", filePath, error);
  }
}

export function recordKeyedDefect(
  defect: DefectRecordInput,
  options: DefectLogOptions = {},
): DefectLogResult {
  const targetPath = resolveDefectLogPath(options);
  const deduplicate = options.deduplicate !== false;
  const keyOptsObj = options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {};

  if (!targetPath) {
    const entry = toAggregatedDefect(defect, keyOptsObj);
    return {
      recorded: entry,
      isNew: true,
      totalEntries: 1,
      filePath: "",
    };
  }

  const liveDedupOpts: LiveDeduplicationOptions = {
    ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
    ...(options.windowMs !== undefined ? { windowMs: options.windowMs } : {}),
    ...(options.maxOccurrencesTracked !== undefined
      ? { maxOccurrencesTracked: options.maxOccurrencesTracked }
      : {}),
    ...(options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {}),
  };

  return withDefectLogMutationLock(targetPath, () => {
    const existingEntries = readDefectLogFile(targetPath, liveDedupOpts);
    const key = computeDefectDiscriminator(defect, options.keyOptions);
    const existingIndex = existingEntries.findIndex((e) => e.dedup_key === key);

    let recorded: AggregatedDefect;
    let isNew = false;

    if (!deduplicate || existingIndex < 0) {
      recorded = toAggregatedDefect(defect, keyOptsObj);
      existingEntries.push(recorded);
      isNew = true;
    } else {
      const existing = existingEntries[existingIndex];
      if (existing) {
        recorded = aggregateDefectEntries(
          existing,
          defect,
          options.maxOccurrencesTracked !== undefined
            ? { maxOccurrences: options.maxOccurrencesTracked }
            : {},
        );
        existingEntries[existingIndex] = recorded;
      } else {
        recorded = toAggregatedDefect(defect, keyOptsObj);
        existingEntries.push(recorded);
        isNew = true;
      }
    }

    replaceDefectLogFileUnlocked(targetPath, serializeAggregatedDefectLog(existingEntries));
    return {
      recorded,
      isNew,
      totalEntries: existingEntries.length,
      filePath: targetPath,
    };
  });
}

export function compactDefectLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): { totalBefore: number; totalAfter: number; filePath: string } {
  return withDefectLogMutationLock(filePath, () => {
    if (!existsSync(filePath)) {
      return { totalBefore: 0, totalAfter: 0, filePath };
    }
    const deps = getDefectLogDependencies();
    const rawContent = deps.readFile(filePath, "utf-8");
    const rawLines = rawContent
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const totalBefore = rawLines.length;
    const aggregated = parseAndDeduplicateDefectJsonl(rawContent, options);
    const totalAfter = aggregated.length;
    replaceDefectLogFileUnlocked(filePath, serializeAggregatedDefectLog(aggregated));
    return { totalBefore, totalAfter, filePath };
  });
}

export {
  withDefectLogMutationLock,
  replaceDefectLogFileUnlocked,
  setDefectLogDependenciesForTesting,
  withDefectLedgerTransaction,
  appendDefectLedgerRecord,
  pruneDefectLedgerRecords,
  promoteDefectLedgerRecords,
  recoverDefectPromotion,
  __setDefectPromotionPersistenceTestHook,
  aggregateDefectEntries,
  deduplicateDefectLog,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
};

export type {
  DefectLogOptions,
  DefectLogResult,
  StrictDefectLedgerEntry,
  DefectPromotionPersistenceStage,
};

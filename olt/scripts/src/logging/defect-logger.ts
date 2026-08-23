import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  aggregateDefectEntries,
  computeDefectDiscriminator,
  parseAndDeduplicateDefectJsonl,
  serializeAggregatedDefectLog,
  toAggregatedDefect,
} from "../mind/defects/index.ts";
import type {
  AggregatedDefect,
  DefectRecordInput,
  LiveDeduplicationOptions,
} from "../mind/defects/types.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import type { DefectLogOptions, DefectLogResult } from "./types.ts";
import { resolveDefectsPath } from "../core/shared/paths.ts";

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
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseAndDeduplicateDefectJsonl(content, options);
  } catch {
    return [];
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

  try {
    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    const liveDedupOpts: LiveDeduplicationOptions = {
      ...(options.strategy !== undefined ? { strategy: options.strategy } : {}),
      ...(options.windowMs !== undefined ? { windowMs: options.windowMs } : {}),
      ...(options.maxOccurrencesTracked !== undefined
        ? { maxOccurrencesTracked: options.maxOccurrencesTracked }
        : {}),
      ...(options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {}),
    };

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

    const serialized = serializeAggregatedDefectLog(existingEntries);
    const encoded = new TextEncoder().encode(serialized);
    atomicWriteBytes(targetPath, encoded);

    return {
      recorded,
      isNew,
      totalEntries: existingEntries.length,
      filePath: targetPath,
    };
  } catch {
    const fallback = toAggregatedDefect(defect, keyOptsObj);
    return {
      recorded: fallback,
      isNew: true,
      totalEntries: 1,
      filePath: targetPath,
    };
  }
}

export function compactDefectLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): { totalBefore: number; totalAfter: number; filePath: string } {
  if (!existsSync(filePath)) {
    return { totalBefore: 0, totalAfter: 0, filePath };
  }

  const rawContent = readFileSync(filePath, "utf-8");
  const rawLines = rawContent
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const totalBefore = rawLines.length;

  const aggregated = parseAndDeduplicateDefectJsonl(rawContent, options);
  const totalAfter = aggregated.length;

  const serialized = serializeAggregatedDefectLog(aggregated);
  const encoded = new TextEncoder().encode(serialized);
  atomicWriteBytes(filePath, encoded);

  return { totalBefore, totalAfter, filePath };
}

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  aggregateBlunderEntries,
  computeBlunderDiscriminator,
  parseAndDeduplicateBlunderJsonl,
  serializeAggregatedBlunderLog,
  toAggregatedBlunder,
} from "../blunders/index.ts";
import type {
  AggregatedBlunder,
  BlunderRecordInput,
  LiveDeduplicationOptions,
} from "../blunders/types.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import type { BlunderLogOptions, BlunderLogResult } from "./types.ts";

export function resolveBlunderLogPath(options: BlunderLogOptions = {}): string | null {
  if (options.filePath) {
    return resolve(options.filePath);
  }
  if (options.runRoot) {
    return join(resolve(options.runRoot), "blunders.jsonl");
  }
  if (options.targetDir) {
    return join(resolve(options.targetDir), "blunders.jsonl");
  }
  if (options.cwd) {
    const defaultCapsules = join(resolve(options.cwd), ".capsules");
    if (existsSync(defaultCapsules)) {
      return join(defaultCapsules, "blunders.jsonl");
    }
  }
  return null;
}

export function readBlunderLogFile(
  filePath: string,
  options: LiveDeduplicationOptions = {},
): AggregatedBlunder[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseAndDeduplicateBlunderJsonl(content, options);
  } catch {
    return [];
  }
}

export function recordKeyedBlunder(
  blunder: BlunderRecordInput,
  options: BlunderLogOptions = {},
): BlunderLogResult {
  const targetPath = resolveBlunderLogPath(options);
  const deduplicate = options.deduplicate !== false;

  const keyOptsObj = options.keyOptions !== undefined ? { keyOptions: options.keyOptions } : {};

  if (!targetPath) {
    const entry = toAggregatedBlunder(blunder, keyOptsObj);
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

    const existingEntries = readBlunderLogFile(targetPath, liveDedupOpts);

    const key = computeBlunderDiscriminator(blunder, options.keyOptions);
    const existingIndex = existingEntries.findIndex((e) => e.dedup_key === key);

    let recorded: AggregatedBlunder;
    let isNew = false;

    if (!deduplicate || existingIndex < 0) {
      recorded = toAggregatedBlunder(blunder, keyOptsObj);
      existingEntries.push(recorded);
      isNew = true;
    } else {
      const existing = existingEntries[existingIndex];
      if (existing) {
        recorded = aggregateBlunderEntries(
          existing,
          blunder,
          options.maxOccurrencesTracked !== undefined
            ? { maxOccurrences: options.maxOccurrencesTracked }
            : {},
        );
        existingEntries[existingIndex] = recorded;
      } else {
        recorded = toAggregatedBlunder(blunder, keyOptsObj);
        existingEntries.push(recorded);
        isNew = true;
      }
    }

    const serialized = serializeAggregatedBlunderLog(existingEntries);
    const encoded = new TextEncoder().encode(serialized);
    atomicWriteBytes(targetPath, encoded);

    return {
      recorded,
      isNew,
      totalEntries: existingEntries.length,
      filePath: targetPath,
    };
  } catch {
    const fallback = toAggregatedBlunder(blunder, keyOptsObj);
    return {
      recorded: fallback,
      isNew: true,
      totalEntries: 1,
      filePath: targetPath,
    };
  }
}

export function compactBlunderLogFile(
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

  const aggregated = parseAndDeduplicateBlunderJsonl(rawContent, options);
  const totalAfter = aggregated.length;

  const serialized = serializeAggregatedBlunderLog(aggregated);
  const encoded = new TextEncoder().encode(serialized);
  atomicWriteBytes(filePath, encoded);

  return { totalBefore, totalAfter, filePath };
}

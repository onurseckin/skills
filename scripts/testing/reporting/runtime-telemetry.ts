/**
 * Test Runtime Telemetry and Pareto Ranking Engine
 * Parses test runner timing telemetry, calculates Pareto 50/90 distributions, and manages pagination slicing.
 */
import type { ParetoThreshold, TestFileRuntime, TestRuntimeSummary } from "./types.ts";

export function parseDurationToMs(durationStr: string): number {
  const trimmed = durationStr.trim().toLowerCase();
  if (trimmed.endsWith("ms")) {
    const val = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isNaN(val) ? 0 : Math.round(val * 100) / 100;
  }
  if (trimmed.endsWith("µs") || trimmed.endsWith("us")) {
    const val = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isNaN(val) ? 0 : Math.round((val / 1000) * 1000) / 1000;
  }
  if (trimmed.endsWith("s")) {
    const val = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isNaN(val) ? 0 : Math.round(val * 1000 * 100) / 100;
  }
  const val = Number.parseFloat(trimmed);
  return Number.isNaN(val) ? 0 : Math.round(val * 100) / 100;
}

export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[\d+;?\d*m/gu, "");
}

export function calculateParetoThreshold(
  files: readonly TestFileRuntime[],
  targetPercentage: number,
): ParetoThreshold {
  if (files.length === 0) {
    return {
      percentage: targetPercentage,
      fileCount: 0,
      cumulativeDurationMs: 0,
      files: [],
    };
  }

  const sorted = [...files].sort((a, b) => b.durationMs - a.durationMs);
  const totalMs = sorted.reduce((acc, curr) => acc + curr.durationMs, 0);

  if (totalMs <= 0) {
    return {
      percentage: targetPercentage,
      fileCount: sorted.length,
      cumulativeDurationMs: 0,
      files: sorted,
    };
  }

  let accumulated = 0;
  const selected: TestFileRuntime[] = [];

  for (const f of sorted) {
    selected.push(f);
    accumulated += f.durationMs;
    const currentPct = (accumulated / totalMs) * 100;
    if (currentPct >= targetPercentage) {
      break;
    }
  }

  return {
    percentage: targetPercentage,
    fileCount: selected.length,
    cumulativeDurationMs: Math.round(accumulated * 100) / 100,
    files: selected,
  };
}

export function computeRuntimeSummary(
  files: TestFileRuntime[],
  startTime: string = new Date().toISOString(),
  endTime: string = new Date().toISOString(),
  totalDurationMs?: number,
): TestRuntimeSummary {
  const sorted = [...files].sort((a, b) => b.durationMs - a.durationMs);
  const totalFileMs = sorted.reduce((acc, curr) => acc + curr.durationMs, 0);
  const resolvedTotalMs =
    typeof totalDurationMs === "number" && totalDurationMs > 0 ? totalDurationMs : totalFileMs;

  const filesWithPct: TestFileRuntime[] = sorted.map((f) => ({
    file: f.file,
    durationMs: f.durationMs,
    passed: f.passed,
    testCount: f.testCount,
    percentage: totalFileMs > 0 ? Math.round((f.durationMs / totalFileMs) * 10000) / 100 : 0,
  }));

  const totalFiles = filesWithPct.length;
  const avgDurationMs = totalFiles > 0 ? Math.round((totalFileMs / totalFiles) * 100) / 100 : 0;

  let medianDurationMs = 0;
  if (totalFiles > 0) {
    const durationsAsc = [...filesWithPct].map((f) => f.durationMs).sort((a, b) => a - b);
    const mid = Math.floor(durationsAsc.length / 2);
    if (durationsAsc.length % 2 === 1) {
      medianDurationMs = durationsAsc[mid] ?? 0;
    } else {
      const low = durationsAsc[mid - 1] ?? 0;
      const high = durationsAsc[mid] ?? 0;
      medianDurationMs = Math.round(((low + high) / 2) * 100) / 100;
    }
  }

  const slowestFile = filesWithPct[0];
  const pareto50 = calculateParetoThreshold(filesWithPct, 50);
  const pareto90 = calculateParetoThreshold(filesWithPct, 90);

  return {
    startTime,
    endTime,
    totalDurationMs: Math.round(resolvedTotalMs * 100) / 100,
    totalFiles,
    avgDurationMs,
    medianDurationMs,
    slowestFile,
    files: filesWithPct,
    pareto50,
    pareto90,
  };
}

export function parseTestRuntimeOutput(
  rawOutput: string,
  startTime: string = new Date().toISOString(),
  endTime: string = new Date().toISOString(),
  forcedTotalDurationMs?: number,
): TestRuntimeSummary {
  const clean = stripAnsi(rawOutput);
  const lines = clean.split("\n");

  const fileMap = new Map<string, { durationMs: number; passed: boolean; testCount: number }>();

  let currentFile: string | null = null;
  let overallDurationMs: number | undefined = forcedTotalDurationMs;

  const testFileHeaderRegex = /^([a-zA-Z0-9_\-./]+\.(?:test|spec)\.[a-zA-Z0-9]+):?\s*$/;
  const testTimingRegex = /\[([0-9.]+\s*(?:ms|s|µs|us))\]/;
  const overallSummaryRegex =
    /Ran\s+\d+\s+tests?\s+across\s+\d+\s+files?\.?\s*\[([0-9.]+\s*(?:ms|s|µs|us))\]/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const overallMatch = line.match(overallSummaryRegex);
    if (overallMatch && overallMatch[1]) {
      const parsed = parseDurationToMs(overallMatch[1]);
      if (parsed > 0 && typeof overallDurationMs === "undefined") {
        overallDurationMs = parsed;
      }
      continue;
    }

    const headerMatch = line.match(testFileHeaderRegex);
    if (headerMatch && headerMatch[1]) {
      currentFile = headerMatch[1].replace(/:$/, "");
      if (!fileMap.has(currentFile)) {
        fileMap.set(currentFile, { durationMs: 0, passed: true, testCount: 0 });
      }
      continue;
    }

    if (currentFile && fileMap.has(currentFile)) {
      const timingMatch = line.match(testTimingRegex);
      if (timingMatch && timingMatch[1]) {
        const dur = parseDurationToMs(timingMatch[1]);
        const entry = fileMap.get(currentFile)!;
        entry.durationMs = Math.round((entry.durationMs + dur) * 100) / 100;
        entry.testCount += 1;
        if (line.toLowerCase().includes("(fail)") || line.includes("✗")) {
          entry.passed = false;
        }
      }
    }
  }

  const filesArray: TestFileRuntime[] = Array.from(fileMap.entries()).map(([filePath, data]) => ({
    file: filePath,
    durationMs: data.durationMs,
    percentage: 0,
    passed: data.passed,
    testCount: data.testCount,
  }));

  return computeRuntimeSummary(filesArray, startTime, endTime, overallDurationMs);
}

export interface PaginationResult<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly totalItems: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  readonly items: readonly T[];
}

export function sliceRuntimePagination<T>(
  items: readonly T[],
  page: number,
  pageSize: number = 50,
): PaginationResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.max(1, Math.min(Math.floor(page || 1), totalPages));
  const startIndex = (clampedPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const sliced = items.slice(startIndex, endIndex);

  return {
    page: clampedPage,
    pageSize,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
    items: sliced,
  };
}

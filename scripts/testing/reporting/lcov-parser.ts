/**
 * LCOV Coverage Record Parser
 * Parses lcov.info output from test coverage engines and builds normalized file coverage metrics.
 */
import { relative, resolve } from "node:path";
import type { FileCoverageMetric } from "./types.ts";
import { createMetricItem } from "./types.ts";

function parseCount(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function parseLcov(lcovContent: string, repoRoot?: string): Map<string, FileCoverageMetric> {
  const root = repoRoot !== undefined ? resolve(repoRoot) : process.cwd();
  const fileMap = new Map<string, FileCoverageMetric>();

  const lines = lcovContent.split(/\r?\n/);
  let currentFile: string | null = null;
  let fnFound = 0;
  let fnHit = 0;
  let lineFound = 0;
  let lineHit = 0;
  const uncoveredLines: number[] = [];
  const lineHitsMap = new Map<number, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("SF:")) {
      currentFile = trimmed.slice(3).trim();
      fnFound = 0;
      fnHit = 0;
      lineFound = 0;
      lineHit = 0;
      uncoveredLines.length = 0;
      lineHitsMap.clear();
    } else if (trimmed.startsWith("FNF:")) {
      fnFound = parseCount(trimmed.slice(4));
    } else if (trimmed.startsWith("FNH:")) {
      fnHit = parseCount(trimmed.slice(4));
    } else if (trimmed.startsWith("LF:")) {
      lineFound = parseCount(trimmed.slice(3));
    } else if (trimmed.startsWith("LH:")) {
      lineHit = parseCount(trimmed.slice(3));
    } else if (trimmed.startsWith("DA:")) {
      const parts = trimmed.slice(3).split(",");
      const rawLineNo = parts[0];
      const rawHitCount = parts[1];
      const lineNo =
        typeof rawLineNo === "string" && rawLineNo.length > 0 ? parseCount(rawLineNo) : 0;
      const hitCount =
        typeof rawHitCount === "string" && rawHitCount.length > 0 ? parseCount(rawHitCount) : 0;
      if (lineNo > 0) {
        lineHitsMap.set(lineNo, hitCount);
        if (hitCount === 0) {
          uncoveredLines.push(lineNo);
        }
      }
    } else if (trimmed === "end_of_record" && currentFile !== null) {
      const relPath = relative(root, resolve(root, currentFile));
      const lineMetric = createMetricItem(lineHit, lineFound);
      const fnMetric = createMetricItem(fnHit, fnFound);

      fileMap.set(relPath, {
        file: relPath,
        lines: lineMetric,
        statements: lineMetric,
        functions: fnMetric,
        uncoveredLines: [...uncoveredLines],
        lineHits: new Map(lineHitsMap),
      });
      currentFile = null;
    }
  }

  return fileMap;
}

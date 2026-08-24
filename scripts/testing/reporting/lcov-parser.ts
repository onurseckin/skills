/**
 * LCOV Coverage Record Parser
 * Parses lcov.info output from test coverage engines and builds normalized file coverage metrics.
 */
import { relative, resolve } from "node:path";
import type { FileCoverageMetric } from "./types.ts";
import { createMetricItem } from "./types.ts";

export function parseLcov(lcovContent: string, repoRoot?: string): Map<string, FileCoverageMetric> {
  const root = repoRoot ? resolve(repoRoot) : process.cwd();
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
      fnFound = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("FNH:")) {
      fnHit = parseInt(trimmed.slice(4), 10) || 0;
    } else if (trimmed.startsWith("LF:")) {
      lineFound = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith("LH:")) {
      lineHit = parseInt(trimmed.slice(3), 10) || 0;
    } else if (trimmed.startsWith("DA:")) {
      const parts = trimmed.slice(3).split(",");
      const lineNo = parseInt(parts[0] ?? "0", 10);
      const hitCount = parseInt(parts[1] ?? "0", 10);
      if (lineNo > 0) {
        lineHitsMap.set(lineNo, hitCount);
        if (hitCount === 0) {
          uncoveredLines.push(lineNo);
        }
      }
    } else if (trimmed === "end_of_record" && currentFile) {
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

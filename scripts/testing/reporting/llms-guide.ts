import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, DeficitRoadmap, TestRuntimeSummary } from "./types.ts";

export function buildLlmsGuide(
  summary: CoverageSummary,
  filesCount: number = 0,
  runtime?: TestRuntimeSummary,
  deficits?: DeficitRoadmap,
): string {
  const lines = summary.total?.lines ?? { total: 0, covered: 0, pct: 0 };
  const funcs = summary.total?.functions ?? { total: 0, covered: 0, pct: 0 };
  const testsCount = runtime ? runtime.totalFiles : 0;
  const durationMs = runtime ? runtime.totalDurationMs : 0;
  const clusterCount = deficits?.clusters?.length ?? 0;
  const missedLines = lines.total - lines.covered;

  return [
    "# Coverage & Test Telemetry LLM Query Guide",
    "",
    "This directory contains test execution telemetry, production code coverage metrics, deficit roadmaps, and offline visual reports for `@onurseckin/skills`.",
    "",
    "## 1. Fast Executive Metrics Snapshot",
    `- Production Source Files: ${filesCount}`,
    `- Line Coverage: ${lines.pct}% (${lines.covered} covered / ${lines.total} total lines)`,
    `- Function Coverage: ${funcs.pct}% (${funcs.covered} covered / ${funcs.total} total funcs)`,
    `- Unit Test Files Executed: ${testsCount} (${durationMs}ms total suite runtime)`,
    `- Coverage Deficit: ${clusterCount} risk clusters (${missedLines} uncovered lines)`,
    "",
    "## 2. Directory Artifact Index",
    "- `index.html`: 100% offline-first Obsidian Black visual dashboard (hierarchical folder rollup, inline syntax-highlighted code inspection).",
    "- `coverage-summary.json`: Istanbul/NYC-standard JSON map keyed by absolute/relative file path.",
    "- `test-telemetry.json`: Test execution latencies, status (passed/failed), and Pareto distribution (P50/P90 hotspots).",
    "- `deficits.json`: Uncovered line clusters categorized by risk (branching, error-handling, initialization, unexercised-logic).",
    "- `REPORT.md`: Standardized Markdown coverage report.",
    "- `lcov.info`: Raw LCOV record streams.",
    "",
    "## 3. Context-Conserving Query Recipes (DO NOT LOAD FULL JSON FILES)",
    "Loading entire multi-megabyte JSON reports into LLM context wastes tokens. Use these targeted shell one-liners to retrieve file-specific telemetry in <50 tokens:",
    "",
    "### A. Query Coverage Metrics for a Single Source File",
    "```bash",
    "# Output: { lines: { pct, covered, total }, functions: { pct, covered, total } }",
    'bun -e \'const c = require("./coverage/coverage-summary.json"); const key = Object.keys(c).find(k => k.includes("<FILE_PATH>")); console.log(JSON.stringify(key ? c[key] : "NOT_FOUND", null, 2));\'',
    "```",
    "",
    "### B. Query Test Execution Runtime for a Specific Test File",
    "```bash",
    '# Output: { path, durationMs, paretoClass: "p50" | "p90" | "normal", passed }',
    'bun -e \'const r = require("./coverage/test-telemetry.json"); const f = r.files.find(x => x.path.includes("<TEST_NAME>")); console.log(JSON.stringify(f || "NOT_FOUND", null, 2));\'',
    "```",
    "",
    "### C. Query Uncovered Line Clusters & Deficit Details for a Source File",
    "```bash",
    "# Output: array of { lineStart, lineEnd, category, uncoveredCount, sampleCode }",
    'bun -e \'const d = require("./coverage/deficits.json"); const c = d.clusters.filter(x => x.filePath.includes("<FILE_PATH>")); console.log(JSON.stringify(c, null, 2));\'',
    "```",
    "",
    "### D. Query Overall Global Codebase Totals Only",
    "```bash",
    "bun -e 'const c = require(\"./coverage/coverage-summary.json\"); console.log(JSON.stringify(c.total, null, 2));'",
    "```",
    "",
    "### E. List Top 10 Slowest Tests (P50 Hotspots)",
    "```bash",
    "bun -e 'const r = require(\"./coverage/test-telemetry.json\"); const top = r.files.slice(0, 10).map(x => ({ path: x.path, ms: x.durationMs, pareto: x.paretoClass })); console.log(JSON.stringify(top, null, 2));'",
    "```",
    "",
    "### F. List Top 10 Files with Largest Line Deficits",
    "```bash",
    'bun -e \'const c = require("./coverage/coverage-summary.json"); const files = Object.entries(c).filter(([k]) => k !== "total").map(([k, v]) => ({ path: k, miss: v.lines.total - v.lines.covered, pct: v.lines.pct })).sort((a,b) => b.miss - a.miss).slice(0, 10); console.log(JSON.stringify(files, null, 2));\'',
    "```",
    "",
    "---",
    "Generated automatically by `@onurseckin/skills` test reporting engine.",
    "",
  ].join("\n");
}

export function writeLlmsGuide(
  summary: CoverageSummary,
  targetPathOrRepoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
  filesCount: number = 0,
  runtime?: TestRuntimeSummary,
  deficits?: DeficitRoadmap,
): string {
  const root = resolve(targetPathOrRepoRoot);
  const outDir = join(root, coverageDirName);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const content = buildLlmsGuide(summary, filesCount, runtime, deficits);
  const filePath = join(outDir, "LLMS.txt");
  writeFileSync(filePath, content, "utf-8");

  const lowerPath = join(outDir, "llms.txt");
  writeFileSync(lowerPath, content, "utf-8");

  return filePath;
}

export function writeDeficitsJson(
  deficits: DeficitRoadmap,
  targetPathOrRepoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
): string {
  const root = resolve(targetPathOrRepoRoot);
  const outDir = join(root, coverageDirName);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const filePath = join(outDir, "deficits.json");
  writeFileSync(filePath, JSON.stringify(deficits, null, 2), "utf-8");
  return filePath;
}

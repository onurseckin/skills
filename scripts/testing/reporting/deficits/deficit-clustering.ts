/**
 * Automated Coverage Deficit Clustering Engine
 * Groups contiguous uncovered line segments into risk clusters, calculates potential
 * repo and file impact percentages, categorizes risk, and produces prioritized remediation roadmaps.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyDeficitCategory,
  getCategoryBadge,
  type DeficitCategoryClassification,
} from "./deficit-categorizer.ts";
import type {
  DeficitClusteringOptions,
  DeficitCluster,
  DeficitRoadmap,
  FileCoverageMetric,
} from "../types.ts";

export type { DeficitCategoryClassification };
export { classifyDeficitCategory, getCategoryBadge };

export interface ContiguousLineSegment {
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
}

/**
 * Groups an arbitrary list of uncovered line numbers into sorted contiguous segments.
 */
export function groupContiguousLines(uncoveredLines: readonly number[]): ContiguousLineSegment[] {
  if (!uncoveredLines || uncoveredLines.length === 0) return [];

  const validLines = Array.from(
    new Set(
      uncoveredLines.filter(
        (n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0,
      ),
    ),
  ).sort((a, b) => a - b);

  if (validLines.length === 0) return [];

  const segments: ContiguousLineSegment[] = [];
  let currentStart = validLines[0]!;
  let currentEnd = validLines[0]!;

  for (let i = 1; i < validLines.length; i++) {
    const line = validLines[i]!;
    if (line === currentEnd + 1) {
      currentEnd = line;
    } else {
      segments.push({
        startLine: currentStart,
        endLine: currentEnd,
        lineCount: currentEnd - currentStart + 1,
      });
      currentStart = line;
      currentEnd = line;
    }
  }

  segments.push({
    startLine: currentStart,
    endLine: currentEnd,
    lineCount: currentEnd - currentStart + 1,
  });

  return segments;
}

/**
 * Computes potential percentage gain for a given line count against total lines.
 */
export function calculateImpactPct(lineCount: number, totalLines: number): number {
  if (totalLines <= 0 || lineCount <= 0) return 0;
  const pct = (lineCount / totalLines) * 100;
  return Math.round(pct * 100) / 100;
}

/**
 * Builds deficit clusters for a specific file metric.
 */
export function buildDeficitClusters(
  file: string,
  uncoveredLines: readonly number[],
  totalFileLines: number,
  totalRepoLines: number,
  sourceCode?: string | readonly string[] | undefined,
): DeficitCluster[] {
  const segments = groupContiguousLines(uncoveredLines);

  return segments.map((seg) => {
    const cl = classifyDeficitCategory(seg.startLine, seg.endLine, sourceCode);
    const repoImpactPct = calculateImpactPct(seg.lineCount, totalRepoLines);
    const fileImpactPct = calculateImpactPct(seg.lineCount, totalFileLines);
    const id =
      seg.startLine === seg.endLine
        ? `${file}:${seg.startLine}`
        : `${file}:${seg.startLine}-${seg.endLine}`;

    return {
      id,
      file,
      startLine: seg.startLine,
      endLine: seg.endLine,
      lineCount: seg.lineCount,
      category: cl.category,
      categoryReason: cl.reason,
      repoImpactPct,
      fileImpactPct,
      ...(cl.sampleCodeSnippet ? { sampleCodeSnippet: cl.sampleCodeSnippet } : {}),
    };
  });
}

function resolveSourceCode(
  file: string,
  options?: DeficitClusteringOptions,
): string | readonly string[] | undefined {
  if (options?.sourceResolver) {
    return options.sourceResolver(file);
  }
  if (options?.rootDir) {
    try {
      const fullPath = resolve(options.rootDir, file);
      if (existsSync(fullPath)) return readFileSync(fullPath, "utf-8");
    } catch {
      // Return undefined if file unreadable
    }
  }
  return undefined;
}

/**
 * Generates prioritized deficit roadmap across an entire collection of file coverage metrics.
 */
export function generateDeficitRoadmap(
  fileMap: Map<string, FileCoverageMetric> | ReadonlyMap<string, FileCoverageMetric>,
  options?: DeficitClusteringOptions,
): DeficitRoadmap {
  let totalRepoLines = 0;
  for (const metric of fileMap.values()) {
    totalRepoLines += metric.lines.total;
  }

  const allClusters: DeficitCluster[] = [];

  for (const [file, metric] of fileMap.entries()) {
    if (!metric.uncoveredLines || metric.uncoveredLines.length === 0) continue;

    const sourceCode = resolveSourceCode(file, options);
    const clusters = buildDeficitClusters(
      file,
      metric.uncoveredLines,
      metric.lines.total,
      totalRepoLines,
      sourceCode,
    );
    allClusters.push(...clusters);
  }

  // Prioritize descending: repoImpactPct -> lineCount -> fileImpactPct -> file -> startLine
  allClusters.sort((a, b) => {
    if (b.repoImpactPct !== a.repoImpactPct) return b.repoImpactPct - a.repoImpactPct;
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    if (b.fileImpactPct !== a.fileImpactPct) return b.fileImpactPct - a.fileImpactPct;
    const cmp = a.file.localeCompare(b.file);
    if (cmp !== 0) return cmp;
    return a.startLine - b.startLine;
  });

  let totalUncoveredLines = 0;
  const breakdown: Record<DeficitCluster["category"], number> = {
    "error-handling": 0,
    branching: 0,
    "unexercised-logic": 0,
    initialization: 0,
  };

  for (const cluster of allClusters) {
    totalUncoveredLines += cluster.lineCount;
    breakdown[cluster.category] = (breakdown[cluster.category] ?? 0) + 1;
  }

  return {
    totalUncoveredLines,
    totalClusters: allClusters.length,
    totalRepoLines,
    categoryBreakdown: breakdown,
    clusters: allClusters,
  };
}

/**
 * Formats a DeficitRoadmap into a clean, human-readable Markdown section.
 */
export function formatDeficitRoadmapMarkdown(roadmap: DeficitRoadmap, topN: number = 10): string {
  const lines: string[] = ["## 🎯 Coverage Deficit & Remediation Roadmap", ""];

  if (roadmap.clusters.length === 0) {
    lines.push("_No coverage deficits detected. Repository is 100% covered!_", "");
    return lines.join("\n");
  }

  lines.push(
    "| Metric | Count | Description |",
    "| :--- | :--- | :--- |",
    `| **Total Uncovered Lines** | **${roadmap.totalUncoveredLines}** | Total deficit lines across repository |`,
    `| **Risk Clusters** | **${roadmap.totalClusters}** | Contiguous uncovered line segments |`,
    `| **🛡️ Error Handling** | **${roadmap.categoryBreakdown["error-handling"]}** | Catch blocks, throw guards, and error paths |`,
    `| **🔀 Branching** | **${roadmap.categoryBreakdown.branching}** | Conditional switches, ternaries, and guards |`,
    `| **⚙️ Initialization** | **${roadmap.categoryBreakdown.initialization}** | Bootstrap, defaults, and constructor paths |`,
    `| **🧩 Unexercised Logic** | **${roadmap.categoryBreakdown["unexercised-logic"]}** | Functions, routines, and algorithmic bodies |`,
    "",
    "### 🚀 Prioritized Deficit Remediation Plan",
    "",
    "| Rank | Target File & Range | Uncovered Lines | Repo Gain | File Gain | Category | Heuristic Detail |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  );

  const displayedClusters = topN > 0 ? roadmap.clusters.slice(0, topN) : roadmap.clusters;

  displayedClusters.forEach((c, idx) => {
    const badge = getCategoryBadge(c.category);
    const detail = c.sampleCodeSnippet
      ? `\`${c.sampleCodeSnippet}\` (${c.categoryReason})`
      : c.categoryReason;
    lines.push(
      `| ${idx + 1} | \`${c.id}\` | ${c.lineCount} lines | **+${c.repoImpactPct}%** | **+${c.fileImpactPct}%** | ${badge} | ${detail} |`,
    );
  });

  if (topN > 0 && roadmap.clusters.length > topN) {
    lines.push(
      "",
      `_Showing top ${topN} of ${roadmap.clusters.length} prioritized deficit clusters._`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

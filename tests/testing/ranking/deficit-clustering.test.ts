import { describe, expect, test } from "bun:test";
import {
  buildDeficitClusters,
  buildMarkdownReport,
  calculateImpactPct,
  classifyDeficitCategory,
  createMetricItem,
  formatDeficitRoadmapMarkdown,
  generateDeficitRoadmap,
  generateInteractiveHtml,
  getCategoryBadge,
  getDeficitStyles,
  groupContiguousLines,
  type DeficitCategory,
  type DeficitRoadmap,
  type FileCoverageMetric,
} from "../../../scripts/testing/reporting/index.ts";

function createMockMetric(
  file: string,
  totalLines: number,
  coveredLines: number,
  uncoveredLines: number[],
): FileCoverageMetric {
  return {
    file,
    lines: createMetricItem(coveredLines, totalLines),
    statements: createMetricItem(coveredLines, totalLines),
    functions: createMetricItem(coveredLines, totalLines),
    uncoveredLines,
    lineHits: new Map(),
  };
}

describe("Deficit Clustering Engine", () => {
  describe("groupContiguousLines", () => {
    test("handles empty and invalid line inputs", () => {
      expect(groupContiguousLines([])).toEqual([]);
      expect(groupContiguousLines([-1, 0, 1.5, NaN])).toEqual([]);
    });

    test("groups contiguous and isolated line sequences", () => {
      const segments = groupContiguousLines([1, 2, 3, 5, 8, 9, 10, 15]);
      expect(segments).toEqual([
        { startLine: 1, endLine: 3, lineCount: 3 },
        { startLine: 5, endLine: 5, lineCount: 1 },
        { startLine: 8, endLine: 10, lineCount: 3 },
        { startLine: 15, endLine: 15, lineCount: 1 },
      ]);
    });

    test("deduplicates and sorts unordered input", () => {
      const segments = groupContiguousLines([10, 2, 3, 2, 1, 10, 9]);
      expect(segments).toEqual([
        { startLine: 1, endLine: 3, lineCount: 3 },
        { startLine: 9, endLine: 10, lineCount: 2 },
      ]);
    });
  });

  describe("calculateImpactPct", () => {
    test("computes percentage impacts and handles zero denominators", () => {
      expect(calculateImpactPct(0, 100)).toBe(0);
      expect(calculateImpactPct(5, 0)).toBe(0);
      expect(calculateImpactPct(5, 1000)).toBe(0.5);
      expect(calculateImpactPct(1, 3)).toBe(33.33);
      expect(calculateImpactPct(50, 100)).toBe(50);
    });
  });

  describe("classifyDeficitCategory & getCategoryBadge", () => {
    test("getCategoryBadge provides appropriate emoji prefixes", () => {
      const categories: DeficitCategory[] = [
        "error-handling",
        "branching",
        "initialization",
        "unexercised-logic",
      ];
      for (const cat of categories) {
        expect(getCategoryBadge(cat)).toContain(cat);
      }
    });

    test("categorizes error-handling patterns from source lines", () => {
      const code = [
        "function handle() {",
        "  try {",
        "    doTask();",
        "  } catch (err) {",
        "    throw new Error('Task failed');",
        "  }",
        "}",
      ].join("\n");
      const res = classifyDeficitCategory(4, 6, code);
      expect(res.category).toBe("error-handling");
      expect(res.reason).toContain("Error handling");
      expect(res.sampleCodeSnippet).toBe("} catch (err) {");
    });

    test("categorizes branching conditions from source lines", () => {
      const code = [
        "export function check(status: string) {",
        "  if (status === 'active') {",
        "    return true;",
        "  } else switch (status) {",
        "    case 'pending': return false;",
        "  }",
        "}",
      ];
      const res = classifyDeficitCategory(2, 5, code);
      expect(res.category).toBe("branching");
      expect(res.reason).toContain("Conditional branching");
    });

    test("categorizes initialization patterns and top-of-file declarations", () => {
      const code = [
        "import { resolve } from 'node:path';",
        "export const DEFAULT_TIMEOUT = 5000;",
        "export const RETRY_COUNT = 3;",
        "export class Worker {",
        "  constructor(opts) { this.opts = opts; }",
        "}",
      ].join("\n");
      const resTop = classifyDeficitCategory(2, 3, code);
      expect(resTop.category).toBe("initialization");

      const resCtor = classifyDeficitCategory(5, 5, code);
      expect(resCtor.category).toBe("initialization");
    });

    test("categorizes unexercised logic and algorithmic loops", () => {
      const code = [
        "export async function processData(items: string[]) {",
        "  const results = [];",
        "  for (const item of items) {",
        "    const parsed = JSON.parse(item);",
        "    results.push(await compute(parsed));",
        "  }",
        "  return results;",
        "}",
      ];
      const res = classifyDeficitCategory(2, 7, code);
      expect(res.category).toBe("unexercised-logic");
    });

    test("applies positional fallback heuristics when source code is omitted", () => {
      const topInit = classifyDeficitCategory(3, 5);
      expect(topInit.category).toBe("initialization");

      const shortBranch = classifyDeficitCategory(45, 46);
      expect(shortBranch.category).toBe("branching");

      const routineLogic = classifyDeficitCategory(50, 60);
      expect(routineLogic.category).toBe("unexercised-logic");
    });
  });

  describe("buildDeficitClusters & generateDeficitRoadmap", () => {
    test("buildDeficitClusters computes cluster ids and percentage impacts", () => {
      const clusters = buildDeficitClusters("src/app.ts", [10, 11, 12, 25], 50, 200);
      expect(clusters).toHaveLength(2);
      expect(clusters[0]?.id).toBe("src/app.ts:10-12");
      expect(clusters[0]?.lineCount).toBe(3);
      expect(clusters[0]?.fileImpactPct).toBe(6);
      expect(clusters[0]?.repoImpactPct).toBe(1.5);
      expect(clusters[1]?.id).toBe("src/app.ts:25");
      expect(clusters[1]?.lineCount).toBe(1);
    });

    test("generateDeficitRoadmap aggregates and prioritizes clusters descending by impact", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["src/a.ts", createMockMetric("src/a.ts", 100, 95, [1, 2, 3, 4, 5])],
        [
          "src/b.ts",
          createMockMetric("src/b.ts", 100, 80, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
        ],
        ["src/c.ts", createMockMetric("src/c.ts", 100, 100, [])],
      ]);

      const roadmap = generateDeficitRoadmap(fileMap);
      expect(roadmap.totalUncoveredLines).toBe(16);
      expect(roadmap.totalClusters).toBe(2);
      expect(roadmap.totalRepoLines).toBe(300);
      expect(roadmap.clusters[0]?.file).toBe("src/b.ts");
      expect(roadmap.clusters[0]?.lineCount).toBe(11);
      expect(roadmap.clusters[0]?.repoImpactPct).toBe(3.67);
      expect(roadmap.clusters[1]?.file).toBe("src/a.ts");
    });

    test("generateDeficitRoadmap respects sourceResolver option", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["src/err.ts", createMockMetric("src/err.ts", 20, 18, [15, 16])],
      ]);
      const sourceMap: Record<string, string> = {
        "src/err.ts": Array.from({ length: 14 }, () => "const x = 1;")
          .concat(["throw new Error();", "return null;"])
          .join("\n"),
      };
      const roadmap = generateDeficitRoadmap(fileMap, {
        sourceResolver: (f) => sourceMap[f],
      });
      expect(roadmap.clusters[0]?.category).toBe("error-handling");
      expect(roadmap.categoryBreakdown["error-handling"]).toBe(1);
    });
  });

  describe("formatDeficitRoadmapMarkdown & HTML Dashboard Integration", () => {
    test("formats 100% covered roadmap with clean success message", () => {
      const emptyRoadmap: DeficitRoadmap = {
        totalUncoveredLines: 0,
        totalClusters: 0,
        totalRepoLines: 100,
        categoryBreakdown: {
          "error-handling": 0,
          branching: 0,
          "unexercised-logic": 0,
          initialization: 0,
        },
        clusters: [],
      };
      const md = formatDeficitRoadmapMarkdown(emptyRoadmap);
      expect(md).toContain("## 🎯 Coverage Deficit & Remediation Roadmap");
      expect(md).toContain("100% covered");
    });

    test("formats populated roadmap table and caps topN with pagination notice", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["src/f1.ts", createMockMetric("src/f1.ts", 50, 48, [10, 11])],
        ["src/f2.ts", createMockMetric("src/f2.ts", 50, 47, [20, 21, 22])],
        ["src/f3.ts", createMockMetric("src/f3.ts", 50, 46, [30, 31, 32, 33])],
      ]);
      const roadmap = generateDeficitRoadmap(fileMap);
      const md = formatDeficitRoadmapMarkdown(roadmap, 2);
      expect(md).toContain("## 🎯 Coverage Deficit & Remediation Roadmap");
      expect(md).toContain("`src/f3.ts:30-33`");
      expect(md).toContain("_Showing top 2 of 3 prioritized deficit clusters._");
    });

    test("buildMarkdownReport enriches report with deficit roadmap section", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["src/core.ts", createMockMetric("src/core.ts", 100, 80, [15, 16, 17, 18, 19])],
      ]);
      const summary = {
        total: {
          lines: createMetricItem(80, 100),
          statements: createMetricItem(80, 100),
          functions: createMetricItem(80, 100),
        },
      };
      const md = buildMarkdownReport(fileMap, summary);
      expect(md).toContain("## 🎯 Coverage Deficit & Remediation Roadmap");
      expect(md).toContain("`src/core.ts:15-19`");
    });

    test("generateInteractiveHtml includes deficit payload, styles, and tab markup", () => {
      const fileMap = new Map<string, FileCoverageMetric>([
        ["src/core.ts", createMockMetric("src/core.ts", 100, 80, [15, 16, 17, 18, 19])],
      ]);
      const summary = {
        total: {
          lines: createMetricItem(80, 100),
          statements: createMetricItem(80, 100),
          functions: createMetricItem(80, 100),
        },
      };
      const html = generateInteractiveHtml(fileMap, summary, process.cwd());
      expect(html).toContain("tab-deficits");
      expect(html).toContain("deficits-section");
      expect(html).toContain("val-def-uncovered");
      expect(html).toContain("val-def-clusters");
      expect(html).toContain("val-def-error");
      expect(html).toContain("filter-def-error-handling");
      expect(getDeficitStyles()).toContain(".deficit-kpi-grid");
    });
  });
});

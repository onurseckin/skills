import { describe, expect, test, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  calculatePct,
  createMetricItem,
  computeIsMain,
  main,
  parseLcov,
  buildCoverageSummary,
  writeSummaryJson,
  buildMarkdownReport,
  writeMarkdownReport,
  generateInteractiveHtml,
  writeInteractiveHtml,
  getHtmlStyles,
  getClientScript,
  buildHtmlDocument,
  extractCoverageFileData,
  processCoverageArtifacts,
  type FileCoverageMetric,
  type CoverageSummary,
} from "../../../scripts/testing/reporting/index.ts";

const TEST_SCRATCH_DIR = join(process.cwd(), "coverage/scratch/coverage-reporting-test-unit");

describe("Coverage Reporting Modules", () => {
  beforeEach(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
  });

  describe("types and metric helpers", () => {
    test("calculatePct handles zero total gracefully", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
      expect(calculatePct(5, -1)).toBe(100);
    });

    test("calculatePct computes rounded percentages", () => {
      expect(calculatePct(50, 100)).toBe(50);
      expect(calculatePct(1, 3)).toBe(33.33);
      expect(calculatePct(2, 3)).toBe(66.67);
      expect(calculatePct(10, 10)).toBe(100);
    });

    test("createMetricItem constructs MetricItem correctly", () => {
      const metric = createMetricItem(8, 10);
      expect(metric.total).toBe(10);
      expect(metric.covered).toBe(8);
      expect(metric.skipped).toBe(0);
      expect(metric.pct).toBe(80);
    });

    test("computeIsMain detects main and argv path correctly", () => {
      expect(computeIsMain(true)).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting/index.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting")).toBe(true);
      expect(computeIsMain(false, "/repo/other.ts")).toBe(false);
    });
  });

  describe("lcov-parser", () => {
    test("parseLcov parses valid LCOV record correctly", () => {
      const sampleLcov = [
        "SF:src/foo.ts",
        "FNF:2",
        "FNH:1",
        "LF:10",
        "LH:8",
        "DA:1,1",
        "DA:2,1",
        "DA:3,0",
        "DA:4,1",
        "DA:5,0",
        "DA:0,0", // invalid line number ignored
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(1);

      const metric = fileMap.get("src/foo.ts");
      expect(metric).toBeDefined();
      if (!metric) return;

      expect(metric.lines.total).toBe(10);
      expect(metric.lines.covered).toBe(8);
      expect(metric.lines.pct).toBe(80);
      expect(metric.statements.total).toBe(10);
      expect(metric.statements.covered).toBe(8);
      expect(metric.statements.pct).toBe(80);
      expect(metric.functions.total).toBe(2);
      expect(metric.functions.covered).toBe(1);
      expect(metric.functions.pct).toBe(50);
      expect(metric.uncoveredLines).toEqual([3, 5]);
      expect(metric.lineHits.get(1)).toBe(1);
      expect(metric.lineHits.get(3)).toBe(0);
    });

    test("parseLcov handles empty and whitespace content", () => {
      const fileMap = parseLcov("   \n\n", TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(0);
    });

    test("parseLcov handles fallback defaults for missing numeric fields", () => {
      const sampleLcov = [
        "SF:src/empty-nums.ts",
        "FNF:",
        "FNH:",
        "LF:",
        "LH:",
        "DA:,",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(1);
      const metric = fileMap.get("src/empty-nums.ts");
      expect(metric).toBeDefined();
      expect(metric?.lines.total).toBe(0);
      expect(metric?.functions.total).toBe(0);
    });
  });

  describe("summary-reporter", () => {
    test("buildCoverageSummary aggregates metrics across multiple files", () => {
      const sampleLcov = [
        "SF:src/a.ts",
        "FNF:1",
        "FNH:1",
        "LF:10",
        "LH:10",
        "end_of_record",
        "SF:src/b.ts",
        "FNF:2",
        "FNH:1",
        "LF:10",
        "LH:5",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      expect(summary["src/a.ts"]).toBeDefined();
      expect(summary["src/b.ts"]).toBeDefined();
      expect(summary.total).toBeDefined();

      expect(summary.total.lines.total).toBe(20);
      expect(summary.total.lines.covered).toBe(15);
      expect(summary.total.lines.pct).toBe(75);
      expect(summary.total.statements.total).toBe(20);
      expect(summary.total.statements.covered).toBe(15);
      expect(summary.total.statements.pct).toBe(75);
      expect(summary.total.functions.total).toBe(3);
      expect(summary.total.functions.covered).toBe(2);
    });

    test("writeSummaryJson writes valid JSON file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const summaryPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "nested/cov");
      expect(existsSync(summaryPath)).toBe(true);

      const parsed = JSON.parse(readFileSync(summaryPath, "utf-8")) as {
        [key: string]: { lines: { pct: number } };
        total: { lines: { pct: number } };
      };
      expect(parsed["src/a.ts"]).toBeDefined();
      expect(parsed.total.lines.pct).toBe(100);
    });
  });

  describe("markdown-reporter", () => {
    test("buildMarkdownReport formats table, status glyphs, and more than 10 uncovered lines", () => {
      const sampleLcov = [
        "SF:src/good.ts",
        "LF:10",
        "LH:10",
        "FNF:1",
        "FNH:1",
        "end_of_record",
        "SF:src/warn.ts",
        "LF:10",
        "LH:8",
        "FNF:10",
        "FNH:8",
        "DA:1,0",
        "DA:2,0",
        "end_of_record",
        "SF:src/bad.ts",
        "LF:20",
        "LH:2",
        "FNF:2",
        "FNH:0",
        "DA:1,0",
        "DA:2,0",
        "DA:3,0",
        "DA:4,0",
        "DA:5,0",
        "DA:6,0",
        "DA:7,0",
        "DA:8,0",
        "DA:9,0",
        "DA:10,0",
        "DA:11,0",
        "DA:12,0",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const markdown = buildMarkdownReport(fileMap, summary);

      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("`src/good.ts`");
      expect(markdown).toContain("`src/warn.ts`");
      expect(markdown).toContain("`src/bad.ts`");
      expect(markdown).toContain("🟢 100%");
      expect(markdown).toContain("🟡 80%");
      expect(markdown).toContain("🔴 10%");
      expect(markdown).toContain("(+2 more)");
    });

    test("buildMarkdownReport handles empty summary.total fallback", () => {
      const emptyMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const markdown = buildMarkdownReport(emptyMap, emptySummary);
      expect(markdown).toContain("# Repository Unit Test Coverage Report");
      expect(markdown).toContain("🟢 PASS");
    });

    test("writeMarkdownReport writes REPORT.md file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const reportPath = writeMarkdownReport(fileMap, summary, TEST_SCRATCH_DIR, "nested/cov");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf-8")).toContain("# Repository Unit Test Coverage Report");
    });
  });

  describe("html-reporter", () => {
    test("getHtmlStyles returns valid CSS string", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(":root");
      expect(styles).toContain("--bg-base");
      expect(styles).toContain(".radial-gauge");
      expect(styles).toContain(".code-line.miss");
    });

    test("getClientScript generates functional client JS", () => {
      const script = getClientScript('{"total":{"lines":{"pct":100}},"files":[]}');
      expect(script).toContain("const DATA = ");
      expect(script).toContain("function renderBreadcrumbs()");
      expect(script).toContain("function jumpToLine(");
    });

    test("buildHtmlDocument formats valid HTML5 document", () => {
      const html = buildHtmlDocument("body { color: red; }", "console.log('hi');");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<style>\nbody { color: red; }\n  </style>");
      expect(html).toContain("<script>\nconsole.log('hi');\n  </script>");
    });

    test("extractCoverageFileData extracts file info and handles missing files & read errors gracefully", () => {
      const dummyFile = join(TEST_SCRATCH_DIR, "src/a.ts");
      const dummyDir = join(TEST_SCRATCH_DIR, "src/dir_as_file.ts");
      mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      mkdirSync(dummyDir, { recursive: true });
      writeFileSync(dummyFile, "line1\nline2", "utf-8");

      const sampleLcov = [
        "SF:src/a.ts",
        "LF:2",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "end_of_record",
        "SF:src/missing.ts",
        "LF:1",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
        "SF:src/dir_as_file.ts",
        "LF:1",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const filesData = extractCoverageFileData(fileMap, TEST_SCRATCH_DIR);

      expect(filesData.length).toBe(3);
      const fileA = filesData.find((f) => f.path === "src/a.ts");
      expect(fileA).toBeDefined();
      expect(fileA?.sourceLines?.length).toBe(2);
      expect(fileA?.sourceLines?.[0]?.hits).toBe(1);
      expect(fileA?.sourceLines?.[1]?.hits).toBe(0);

      const fileMissing = filesData.find((f) => f.path === "src/missing.ts");
      expect(fileMissing).toBeDefined();
      expect(fileMissing?.sourceLines).toBeUndefined();

      const fileDir = filesData.find((f) => f.path === "src/dir_as_file.ts");
      expect(fileDir).toBeDefined();
      expect(fileDir?.sourceLines).toBeUndefined();
    });

    test("generateInteractiveHtml embeds files, breadcrumbs, and precision line highlights", () => {
      const dummyFile = join(TEST_SCRATCH_DIR, "src/sample.ts");
      mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      writeFileSync(dummyFile, "const a = 1;\nconst b = 2;\n// comment\nconst c = 3;\n", "utf-8");

      const sampleLcov = [
        "SF:src/sample.ts",
        "LF:3",
        "LH:2",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "DA:4,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Skills Test Coverage");
      expect(html).toContain("src/sample.ts");
      expect(html).toContain("DATA");
      expect(html).toContain("miss-chip");
    });

    test("generateInteractiveHtml handles default summary without total", () => {
      const emptyMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const html = generateInteractiveHtml(emptyMap, emptySummary, TEST_SCRATCH_DIR);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Skills Test Coverage");
    });

    test("writeInteractiveHtml writes index.html file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);

      const htmlPath = writeInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR, "nested/cov");
      expect(existsSync(htmlPath)).toBe(true);
      expect(readFileSync(htmlPath, "utf-8")).toContain("<!DOCTYPE html>");
    });
  });

  describe("unified entrypoint processCoverageArtifacts", () => {
    test("returns lcovExists: false when lcov.info is missing", () => {
      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "nonexistent");
      expect(res.lcovExists).toBe(false);
      expect(res.filesCount).toBe(0);
      expect(res.totalPct).toBe(0);
    });

    test("orchestrates all 3 artifacts when lcov.info is present", () => {
      const covDir = join(TEST_SCRATCH_DIR, "coverage");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage");
      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);

      expect(existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
      expect(existsSync(join(covDir, "REPORT.md"))).toBe(true);
      expect(existsSync(join(covDir, "index.html"))).toBe(true);
    });

    test("recreates coverage directory if removed before artifact writing", () => {
      const covDir = join(TEST_SCRATCH_DIR, "coverage-recreate");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      const lcovPath = join(covDir, "lcov.info");
      writeFileSync(lcovPath, sampleLcov, "utf-8");

      const origExistsSync = fs.existsSync;
      let checkCount = 0;
      const spy = spyOn(fs, "existsSync").mockImplementation((p) => {
        if (p === lcovPath) return true;
        if (p === covDir) {
          checkCount++;
          if (checkCount === 1) return false;
        }
        return origExistsSync(p);
      });

      try {
        const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage-recreate");
        expect(res.lcovExists).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    test("executes CLI script via bun execution", () => {
      const scriptPath = join(process.cwd(), "scripts/testing/reporting/index.ts");

      // Test when lcov.info does not exist
      const runMissing = spawnSync("bun", [scriptPath], {
        cwd: TEST_SCRATCH_DIR,
        encoding: "utf-8",
      });
      expect(runMissing.stdout).toContain("[coverage] No coverage/lcov.info found to process.");

      // Test when lcov.info exists
      const covDir = join(TEST_SCRATCH_DIR, "coverage");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/cli-test.ts\nLF:5\nLH:5\nFNF:1\nFNH:1\nend_of_record";
      writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

      const runPresent = spawnSync("bun", [scriptPath], {
        cwd: TEST_SCRATCH_DIR,
        encoding: "utf-8",
      });
      expect(runPresent.stdout).toContain("[coverage] Generated coverage/lcov.info");
    });

    test("main() executes and logs status depending on lcov existence", () => {
      const origCwd = process.cwd();
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        // 1. Missing lcov
        process.chdir(TEST_SCRATCH_DIR);
        main();
        expect(logs.some((l) => l.includes("No coverage/lcov.info found"))).toBe(true);

        logs.length = 0;

        // 2. Present lcov
        const covDir = join(TEST_SCRATCH_DIR, "coverage");
        mkdirSync(covDir, { recursive: true });
        const sampleLcov = "SF:src/cli-test.ts\nLF:5\nLH:5\nFNF:1\nFNH:1\nend_of_record";
        writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

        main();
        expect(logs.some((l) => l.includes("Generated coverage/lcov.info"))).toBe(true);
      } finally {
        process.chdir(origCwd);
        console.log = origLog;
      }
    });
  });
});

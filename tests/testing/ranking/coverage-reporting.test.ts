import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  buildCoverageSummary,
  buildHtmlDocument,
  buildMarkdownReport,
  calculatePct,
  computeIsMain,
  createMetricItem,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  main,
  parseLcov,
  processCoverageArtifacts,
  writeInteractiveHtml,
  writeMarkdownReport,
  writeSummaryJson,
  type CoverageSummary,
} from "../../../scripts/testing/reporting/index.ts";

const TEST_SCRATCH_DIR = "/virtual/coverage-scratch/coverage-reporting-test-unit";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | undefined;

describe("Coverage Reporting Modules", () => {
  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });

  describe("types and metric helpers", () => {
    test("calculatePct handles zero and negative totals", () => {
      expect(calculatePct(0, 0)).toBe(100);
      expect(calculatePct(5, 0)).toBe(100);
      expect(calculatePct(5, -1)).toBe(100);
      expect(calculatePct(50, 100)).toBe(50);
      expect(calculatePct(1, 3)).toBe(33.33);
    });

    test("createMetricItem constructs MetricItem correctly", () => {
      const metric = createMetricItem(8, 10);
      expect(metric.total).toBe(10);
      expect(metric.covered).toBe(8);
      expect(metric.skipped).toBe(0);
      expect(metric.pct).toBe(80);
    });

    test("computeIsMain detects entry path correctly", () => {
      expect(computeIsMain(true)).toBe(true);
      expect(computeIsMain(false, undefined)).toBe(false);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting/index.ts")).toBe(true);
      expect(computeIsMain(false, "/repo/scripts/testing/reporting")).toBe(true);
      expect(computeIsMain(false, "/repo/other.ts")).toBe(false);
    });
  });

  describe("lcov-parser", () => {
    test("parseLcov parses valid LCOV records and handles empty / malformed content", () => {
      const sample = [
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
        "DA:0,0",
        "end_of_record",
      ].join("\n");
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      expect(fileMap.size).toBe(1);
      const metric = fileMap.get("src/foo.ts");
      expect(metric?.lines.pct).toBe(80);
      expect(metric?.uncoveredLines).toEqual([3, 5]);

      expect(parseLcov("   \n\n", TEST_SCRATCH_DIR).size).toBe(0);
      const fallbackMap = parseLcov("SF:src/empty.ts\nFNF:\nLF:\nend_of_record", TEST_SCRATCH_DIR);
      expect(fallbackMap.get("src/empty.ts")?.lines.total).toBe(0);
    });
  });

  describe("summary-reporter", () => {
    test("buildCoverageSummary aggregates metrics across files", () => {
      const sample =
        "SF:src/a.ts\nLF:10\nLH:10\nend_of_record\nSF:src/b.ts\nLF:10\nLH:5\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      expect(summary.total?.lines.total).toBe(20);
      expect(summary.total?.lines.covered).toBe(15);
      expect(summary.total?.lines.pct).toBe(75);
    });

    test("writeSummaryJson handles disk write, writeToDisk:false bypass, and skips unchanged writes", () => {
      const sample = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const summary = buildCoverageSummary(parseLcov(sample, TEST_SCRATCH_DIR));

      // 1. In-memory bypass
      const memPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-mem", {
        writeToDisk: false,
      });
      expect(existsSync(memPath)).toBe(false);

      // 2. Normal write
      const summaryPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-disk");
      expect(existsSync(summaryPath)).toBe(true);

      // 3. Skip unchanged write
      const writeSpy = spyOn(vfs, "writeFileSync");
      try {
        const cachedPath = writeSummaryJson(summary, TEST_SCRATCH_DIR, "cov-disk");
        expect(cachedPath).toBe(summaryPath);
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        writeSpy.mockRestore();
      }
    });
  });

  describe("markdown-reporter", () => {
    test("buildMarkdownReport and writeMarkdownReport generate markdown correctly", () => {
      const sample =
        "SF:src/a.ts\nLF:10\nLH:8\nDA:1,0\nend_of_record\nSF:src/b.ts\nLF:10\nLH:1\nDA:1,0\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const summary = buildCoverageSummary(fileMap);
      const md = buildMarkdownReport(fileMap, summary);
      expect(md).toContain("# Repository Unit Test Coverage Report");
      expect(md).toContain("🟡 80%");

      const emptySummary: CoverageSummary = {};
      expect(buildMarkdownReport(new Map(), emptySummary)).toContain("🟢 PASS");

      const reportPath = writeMarkdownReport(fileMap, summary, TEST_SCRATCH_DIR, "cov-md");
      expect(existsSync(reportPath)).toBe(true);
    });
  });

  describe("html-reporter", () => {
    test("generates styles, scripts, html document, and interactive dashboard", () => {
      expect(getHtmlStyles()).toContain(":root");
      expect(getClientScript("{}")).toContain("const DATA = {}");
      expect(buildHtmlDocument("/* css */", "/* js */")).toContain("<!DOCTYPE html>");

      const dummyFile = join(TEST_SCRATCH_DIR, "src/sample.ts");
      vfs.mkdirSync(join(TEST_SCRATCH_DIR, "src"), { recursive: true });
      vfs.writeFileSync(dummyFile, "const a = 1;\nconst b = 2;", "utf-8");

      const sample =
        "SF:src/sample.ts\nLF:2\nLH:1\nDA:1,1\nDA:2,0\nend_of_record\nSF:src/missing.ts\nLF:1\nLH:0\nDA:1,0\nend_of_record";
      const fileMap = parseLcov(sample, TEST_SCRATCH_DIR);
      const filesData = extractCoverageFileData(fileMap, TEST_SCRATCH_DIR);
      expect(filesData.length).toBe(2);
      expect(filesData[0]?.sourceLines?.length).toBe(2);
      expect(filesData[1]?.sourceLines).toBeUndefined();

      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR);
      expect(html).toContain("<!DOCTYPE html>");

      const htmlPath = writeInteractiveHtml(fileMap, summary, TEST_SCRATCH_DIR, "cov-html");
      expect(existsSync(htmlPath)).toBe(true);
    });
  });

  describe("unified entrypoint processCoverageArtifacts", () => {
    test("returns lcovExists: false when lcov.info is missing", () => {
      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "nonexistent");
      expect(res.lcovExists).toBe(false);
      expect(res.filesCount).toBe(0);
      expect(res.totalPct).toBe(0);
    });

    test("orchestrates artifacts on disk when lcov.info is present", () => {
      const covDir = join(TEST_SCRATCH_DIR, "coverage");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/test.ts\nLF:10\nLH:10\nend_of_record",
        "utf-8",
      );

      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage");
      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);
      expect(existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
      expect(existsSync(join(covDir, "REPORT.md"))).toBe(true);
      expect(existsSync(join(covDir, "index.html"))).toBe(true);
    });

    test("supports pure zero-disk processing via lcovContent and writeToDisk:false", () => {
      const lcovContent = "SF:src/zero-disk.ts\nLF:20\nLH:20\nend_of_record";
      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage-zero", {
        lcovContent,
        writeToDisk: false,
      });

      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);
      expect(res.summary).toBeDefined();
      expect(res.summaryPath).toBeUndefined();
      expect(existsSync(join(TEST_SCRATCH_DIR, "coverage-zero"))).toBe(false);
    });

    test("recreates coverage directory if removed before artifact writing", () => {
      const covDir = join(TEST_SCRATCH_DIR, "coverage-recreate");
      vfs.mkdirSync(covDir, { recursive: true });
      const lcovPath = join(covDir, "lcov.info");
      vfs.writeFileSync(lcovPath, "SF:src/test.ts\nLF:10\nLH:10\nend_of_record", "utf-8");

      let checkCount = 0;
      const origVfsExists = vfs.existsSync.bind(vfs);
      const spy = spyOn(vfs, "existsSync").mockImplementation((p: string) => {
        if (p === lcovPath) return true;
        if (p === covDir) {
          checkCount++;
          if (checkCount === 1) return false;
        }
        return origVfsExists(p);
      });

      try {
        const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage-recreate");
        expect(res.lcovExists).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    test("executes CLI script and main() logs status appropriately", () => {
      const logs: string[] = [];
      const origLog = console.log;
      const origCwd = process.cwd();
      console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

      try {
        process.chdir(TEST_SCRATCH_DIR);
        main();
        expect(logs.some((l) => l.includes("No coverage/lcov.info found"))).toBe(true);

        logs.length = 0;
        const covDir = join(TEST_SCRATCH_DIR, "coverage");
        vfs.mkdirSync(covDir, { recursive: true });
        vfs.writeFileSync(
          join(covDir, "lcov.info"),
          "SF:src/cli.ts\nLF:5\nLH:5\nend_of_record",
          "utf-8",
        );
        main();
        expect(logs.some((l) => l.includes("Generated coverage/lcov.info"))).toBe(true);
      } finally {
        process.chdir(origCwd);
        console.log = origLog;
      }
    });
  });
});

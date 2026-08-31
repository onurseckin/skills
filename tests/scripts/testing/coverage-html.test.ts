import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseLcov,
  buildCoverageSummary,
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

describe("Coverage HTML Dashboard and Artifact Pipeline", () => {
  const roots: string[] = [];
  let testScratchDir: string;

  beforeEach(() => {
    testScratchDir = realpathSync(mkdtempSync(join(tmpdir(), "cov-html-")));
    roots.push(testScratchDir);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
    }
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
      const dummyFile = join(testScratchDir, "src/a.ts");
      const dummyDir = join(testScratchDir, "src/dir_as_file.ts");
      mkdirSync(join(testScratchDir, "src"), { recursive: true });
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

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const filesData = extractCoverageFileData(fileMap, testScratchDir);

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
      const dummyFile = join(testScratchDir, "src/sample.ts");
      mkdirSync(join(testScratchDir, "src"), { recursive: true });
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

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, testScratchDir);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Coverage & Runtime Dashboard");
      expect(html).toContain("src/sample.ts");
      expect(html).toContain("DATA");
      expect(html).toContain("miss-chip");
    });

    test("generateInteractiveHtml handles default summary without total", () => {
      const emptyMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const html = generateInteractiveHtml(emptyMap, emptySummary, testScratchDir);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Coverage & Runtime Dashboard");
    });

    test("writeInteractiveHtml writes index.html file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);

      const htmlPath = writeInteractiveHtml(fileMap, summary, testScratchDir, "nested/cov");
      expect(existsSync(htmlPath)).toBe(true);
      expect(readFileSync(htmlPath, "utf-8")).toContain("<!DOCTYPE html>");
    });
  });

  describe("unified entrypoint processCoverageArtifacts", () => {
    test("returns lcovExists: false when lcov.info is missing", () => {
      const res = processCoverageArtifacts(testScratchDir, "nonexistent");
      expect(res.lcovExists).toBe(false);
      expect(res.filesCount).toBe(0);
      expect(res.totalPct).toBe(0);
    });

    test("orchestrates all 3 artifacts when lcov.info is present", () => {
      const covDir = join(testScratchDir, "coverage");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

      const res = processCoverageArtifacts(testScratchDir, "coverage");
      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);

      expect(existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
      expect(existsSync(join(covDir, "REPORT.md"))).toBe(true);
      expect(existsSync(join(covDir, "index.html"))).toBe(true);
    });

    test("recreates coverage directory if removed before artifact writing", () => {
      const covDir = join(testScratchDir, "coverage-recreate");
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
        const res = processCoverageArtifacts(testScratchDir, "coverage-recreate");
        expect(res.lcovExists).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    test("executes CLI script via bun execution", () => {
      const scriptPath = join(process.cwd(), "scripts/testing/reporting/index.ts");

      const runMissing = spawnSync("bun", [scriptPath], {
        cwd: testScratchDir,
        encoding: "utf-8",
      });
      expect(runMissing.stdout).toContain("[coverage] No coverage/lcov.info found to process.");

      const covDir = join(testScratchDir, "coverage");
      mkdirSync(covDir, { recursive: true });
      const sampleLcov = "SF:src/cli-test.ts\nLF:5\nLH:5\nFNF:1\nFNH:1\nend_of_record";
      writeFileSync(join(covDir, "lcov.info"), sampleLcov, "utf-8");

      const runPresent = spawnSync("bun", [scriptPath], {
        cwd: testScratchDir,
        encoding: "utf-8",
      });
      expect(runPresent.stdout).toContain("[coverage] Generated coverage/lcov.info");
    });
  });
});

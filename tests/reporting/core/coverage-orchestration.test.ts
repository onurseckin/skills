import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import { main, processCoverageArtifacts } from "../../../scripts/testing/reporting/index.ts";
import {
  cleanupVirtualReportingFS,
  getVirtualReportingFS,
  setupVirtualReportingFS,
  tempDir,
} from "../fixture.ts";

export const coverageOrchestrationSuiteName = "Coverage Pipeline Orchestration & CLI Entrypoints";

describe(coverageOrchestrationSuiteName, () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  describe("unified entrypoint processCoverageArtifacts, main, and computeIsMain", () => {
    it("returns lcovExists: false when lcov.info is missing", () => {
      const tmpRoot = tempDir("cov-orch-missing");
      const result = processCoverageArtifacts(tmpRoot, "missing-cov");
      expect(result.lcovExists).toBe(false);
      expect(result.filesCount).toBe(0);
      expect(result.totalPct).toBe(0);
    });

    it("orchestrates all 3 artifacts when lcov.info is present and handles missing coverageDir creation", () => {
      const tmpRoot = tempDir("cov-orch-present");
      const vfs = getVirtualReportingFS();
      const covDir = join(tmpRoot, "custom-coverage");
      vfs.mkdirSync(covDir, { recursive: true });

      const lcovContent = `
SF:src/core/app.ts
LF:10
LH:10
DA:1,1
DA:2,1
end_of_record
`;
      vfs.writeFileSync(join(covDir, "lcov.info"), lcovContent, "utf-8");

      const result = processCoverageArtifacts(tmpRoot, "custom-coverage");
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.totalPct).toBe(100);
      expect(result.summaryPath).toBeDefined();
      expect(result.reportPath).toBeDefined();
      expect(result.htmlPath).toBeDefined();
      expect(result.deficitsPath).toBeDefined();
      expect(result.llmsGuidePath).toBeDefined();

      if (result.summaryPath) expect(vfs.existsSync(result.summaryPath)).toBe(true);
      if (result.reportPath) expect(vfs.existsSync(result.reportPath)).toBe(true);
      if (result.htmlPath) expect(vfs.existsSync(result.htmlPath)).toBe(true);
      if (result.deficitsPath) expect(vfs.existsSync(result.deficitsPath)).toBe(true);
      if (result.llmsGuidePath) expect(vfs.existsSync(result.llmsGuidePath)).toBe(true);
    });

    it("processCoverageArtifacts with default arguments handles missing and present lcov", () => {
      const tmpRoot = tempDir("cov-orch-default");
      const vfs = getVirtualReportingFS();
      const resMissing = processCoverageArtifacts(tmpRoot);
      expect(resMissing.lcovExists).toBe(false);

      const covDir = join(tmpRoot, "coverage");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/index.ts\nLF:5\nLH:5\nDA:1,1\nend_of_record\n",
        "utf-8",
      );
      const resPresent = processCoverageArtifacts(tmpRoot);
      expect(resPresent.lcovExists).toBe(true);
      expect(resPresent.filesCount).toBe(1);
      expect(resPresent.totalPct).toBe(100);
    });

    it("main() logs appropriate status messages based on lcov existence", () => {
      const origLog = console.log;
      const messages: string[] = [];
      console.log = (...args: readonly unknown[]): void => {
        messages.push(args.map(String).join(" "));
      };

      const tmpRoot = tempDir("cov-orch-main");
      const vfs = getVirtualReportingFS();
      const prevCwd = vfs.cwd();
      vfs.chdir(tmpRoot);

      try {
        // Missing lcov branch
        main();
        expect(messages.length).toBe(1);
        expect(messages[0]).toContain("No coverage/lcov.info found to process.");

        // Present lcov branch
        const covDir = join(tmpRoot, "coverage");
        vfs.mkdirSync(covDir, { recursive: true });
        vfs.writeFileSync(
          join(covDir, "lcov.info"),
          "SF:src/main-test.ts\nLF:2\nLH:2\nDA:1,1\nDA:2,1\nend_of_record\n",
          "utf-8",
        );

        main();
        expect(messages.length).toBe(2);
        expect(messages[1]).toContain("Generated coverage/lcov.info");
      } finally {
        vfs.chdir(prevCwd);
        console.log = origLog;
      }
    });

    it("barrel export exports all expected symbols", () => {
      expect(reporting.calculatePct).toBeDefined();
      expect(reporting.createMetricItem).toBeDefined();
      expect(reporting.parseLcov).toBeDefined();
      expect(reporting.buildCoverageSummary).toBeDefined();
      expect(reporting.writeSummaryJson).toBeDefined();
      expect(reporting.buildMarkdownReport).toBeDefined();
      expect(reporting.writeMarkdownReport).toBeDefined();
      expect(reporting.buildHtmlDocument).toBeDefined();
      expect(reporting.extractCoverageFileData).toBeDefined();
      expect(reporting.generateInteractiveHtml).toBeDefined();
      expect(reporting.getClientScript).toBeDefined();
      expect(reporting.getHtmlStyles).toBeDefined();
      expect(reporting.writeInteractiveHtml).toBeDefined();
      expect(reporting.processCoverageArtifacts).toBeDefined();
      expect(reporting.computeIsMain).toBeDefined();
      expect(reporting.main).toBeDefined();
      expect(reporting.runCli).toBeDefined();
    });

    it("runCli executes main when isMain is true and skips when isMain is false", () => {
      const origLog = console.log;
      const messages: string[] = [];
      console.log = (...args: readonly unknown[]): void => {
        messages.push(args.map(String).join(" "));
      };
      const tmpRoot = tempDir("cov-orch-runcli");
      const vfs = getVirtualReportingFS();
      const prevCwd = vfs.cwd();
      vfs.chdir(tmpRoot);
      try {
        reporting.runCli(false);
        expect(messages.length).toBe(0);

        reporting.runCli(true);
        expect(messages.length).toBeGreaterThan(0);

        const beforeCount = messages.length;
        reporting.runCli();
        expect(messages.length).toBe(beforeCount);
      } finally {
        vfs.chdir(prevCwd);
        console.log = origLog;
      }
    });

    it("handles deeply nested coverage directory creation in VFS", () => {
      const tmpRoot = tempDir("cov-orch-nested");
      const vfs = getVirtualReportingFS();
      const covDir = join(tmpRoot, "nested", "reports", "custom-cov");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/nested.ts\nLF:1\nLH:1\nDA:1,1\nend_of_record\n",
        "utf-8",
      );

      const result = processCoverageArtifacts(tmpRoot, "nested/reports/custom-cov");
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.summaryPath).toBeDefined();
      if (result.summaryPath) expect(vfs.existsSync(result.summaryPath)).toBe(true);
    });

    it("supports in-memory only execution with writeToDisk: false", () => {
      const tmpRoot = tempDir("cov-orch-nowrite");
      const vfs = getVirtualReportingFS();
      const covDir = join(tmpRoot, "coverage");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/mem.ts\nLF:4\nLH:4\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n",
        "utf-8",
      );

      const result = processCoverageArtifacts(tmpRoot, "coverage", { writeToDisk: false });
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.totalPct).toBe(100);
      expect(result.summaryPath).toBeUndefined();
      expect(result.reportPath).toBeUndefined();
      expect(result.htmlPath).toBeUndefined();
      expect(result.deficitsPath).toBeUndefined();
      expect(result.llmsGuidePath).toBeUndefined();
      expect(result.summary).toBeDefined();
    });

    it("gracefully processes empty or malformed lcov without throwing", () => {
      const tmpRoot = tempDir("cov-orch-empty-lcov");
      const vfs = getVirtualReportingFS();
      const covDir = join(tmpRoot, "coverage");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(join(covDir, "lcov.info"), "", "utf-8");

      const resEmpty = processCoverageArtifacts(tmpRoot);
      expect(resEmpty.lcovExists).toBe(true);
      expect(resEmpty.filesCount).toBe(0);
      expect(resEmpty.totalPct).toBe(100);

      vfs.writeFileSync(join(covDir, "lcov.info"), "INVALID_LCOV_LINE_NOT_A_RECORD\n", "utf-8");
      const resMalformed = processCoverageArtifacts(tmpRoot);
      expect(resMalformed.lcovExists).toBe(true);
      expect(resMalformed.filesCount).toBe(0);
      expect(resMalformed.totalPct).toBe(100);
    });
  });
});

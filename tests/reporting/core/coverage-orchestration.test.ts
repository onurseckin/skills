import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import { main, processCoverageArtifacts } from "../../../scripts/testing/reporting/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

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
      const covDir = join(tmpRoot, "custom-coverage");
      fs.mkdirSync(covDir, { recursive: true });

      const lcovContent = `
SF:src/core/app.ts
LF:10
LH:10
DA:1,1
DA:2,1
end_of_record
`;
      fs.writeFileSync(join(covDir, "lcov.info"), lcovContent, "utf-8");

      const result = processCoverageArtifacts(tmpRoot, "custom-coverage");
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.totalPct).toBe(100);
      expect(result.summaryPath).toBeDefined();
      expect(result.reportPath).toBeDefined();
      expect(result.htmlPath).toBeDefined();

      if (result.summaryPath) expect(fs.existsSync(result.summaryPath)).toBe(true);
      if (result.reportPath) expect(fs.existsSync(result.reportPath)).toBe(true);
      if (result.htmlPath) expect(fs.existsSync(result.htmlPath)).toBe(true);
    });

    it("processCoverageArtifacts with default arguments handles missing and present lcov", () => {
      const tmpRoot = tempDir("cov-orch-default");
      const resMissing = processCoverageArtifacts(tmpRoot);
      expect(resMissing.lcovExists).toBe(false);

      const covDir = join(tmpRoot, "coverage");
      fs.mkdirSync(covDir, { recursive: true });
      fs.writeFileSync(
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

      try {
        main();
        expect(messages.length).toBeGreaterThan(0);
      } finally {
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
      try {
        reporting.runCli(false);
        expect(messages.length).toBe(0);

        reporting.runCli(true);
        expect(messages.length).toBeGreaterThan(0);

        const beforeCount = messages.length;
        reporting.runCli();
        expect(messages.length).toBe(beforeCount);
      } finally {
        console.log = origLog;
      }
    });
  });
});

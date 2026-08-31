import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as reporting from "../../../scripts/testing/reporting/index.ts";
import {
  main,
  processCoverageArtifacts,
} from "../../../scripts/testing/reporting/index.ts";

export const coverageOrchestrationSuiteName = "Coverage Pipeline Orchestration & CLI Entrypoints";

describe(coverageOrchestrationSuiteName, () => {
  const tmpRoot = join(process.cwd(), ".tmp-test-reporting-suite-orchestration");

  function cleanupTmp(): void {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  describe("unified entrypoint processCoverageArtifacts, main, and computeIsMain", () => {
    it("returns lcovExists: false when lcov.info is missing", () => {
      cleanupTmp();
      const result = processCoverageArtifacts(tmpRoot, "missing-cov");
      expect(result.lcovExists).toBe(false);
      expect(result.filesCount).toBe(0);
      expect(result.totalPct).toBe(0);
      cleanupTmp();
    });

    it("orchestrates all 3 artifacts when lcov.info is present and handles missing coverageDir creation", () => {
      cleanupTmp();
      const covDir = join(tmpRoot, "custom-coverage");
      mkdirSync(covDir, { recursive: true });

      const lcovContent = `
SF:src/core/app.ts
LF:10
LH:10
DA:1,1
DA:2,1
end_of_record
`;
      writeFileSync(join(covDir, "lcov.info"), lcovContent, "utf-8");

      const result = processCoverageArtifacts(tmpRoot, "custom-coverage");
      expect(result.lcovExists).toBe(true);
      expect(result.filesCount).toBe(1);
      expect(result.totalPct).toBe(100);
      expect(result.summaryPath).toBeDefined();
      expect(result.reportPath).toBeDefined();
      expect(result.htmlPath).toBeDefined();

      if (result.summaryPath) expect(existsSync(result.summaryPath)).toBe(true);
      if (result.reportPath) expect(existsSync(result.reportPath)).toBe(true);
      if (result.htmlPath) expect(existsSync(result.htmlPath)).toBe(true);

      cleanupTmp();
    });

    it("processCoverageArtifacts with default arguments handles missing and present lcov", () => {
      cleanupTmp();
      mkdirSync(tmpRoot, { recursive: true });
      const origCwd = process.cwd();
      try {
        process.chdir(tmpRoot);
        const resMissing = processCoverageArtifacts();
        expect(resMissing.lcovExists).toBe(false);

        const covDir = join(tmpRoot, "coverage");
        mkdirSync(covDir, { recursive: true });
        writeFileSync(
          join(covDir, "lcov.info"),
          "SF:src/index.ts\nLF:5\nLH:5\nDA:1,1\nend_of_record\n",
          "utf-8",
        );
        const resPresent = processCoverageArtifacts();
        expect(resPresent.lcovExists).toBe(true);
        expect(resPresent.filesCount).toBe(1);
        expect(resPresent.totalPct).toBe(100);
      } finally {
        process.chdir(origCwd);
        cleanupTmp();
      }
    });

    it("main() logs appropriate status messages based on lcov existence", () => {
      cleanupTmp();
      mkdirSync(tmpRoot, { recursive: true });
      const origLog = console.log;
      const messages: string[] = [];
      console.log = (...args: readonly unknown[]): void => {
        messages.push(args.map(String).join(" "));
      };

      const origCwd = process.cwd();
      try {
        process.chdir(tmpRoot);
        main();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.includes("No coverage/lcov.info found"))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }

      messages.length = 0;
      const covDir = join(tmpRoot, "coverage");
      mkdirSync(covDir, { recursive: true });
      writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/app.ts\nLF:5\nLH:5\nDA:1,1\nend_of_record\n",
        "utf-8",
      );

      try {
        process.chdir(tmpRoot);
        main();
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.includes("Generated coverage/lcov.info"))).toBe(true);
      } finally {
        process.chdir(origCwd);
        console.log = origLog;
        cleanupTmp();
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

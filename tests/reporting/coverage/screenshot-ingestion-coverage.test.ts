import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { initRun, readCaptures } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  ingestScreenshots,
  ingestVisualReport,
} from "../../../olt/scripts/src/reporting/screenshot-ingestion.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

describe("screenshot-ingestion coverage", () => {
  let sandboxDir: string;
  let runDir: string;

  beforeEach(() => {
    setupVirtualReportingFS();
    sandboxDir = tempDir("screenshot-test");
    runDir = initRun(
      sandboxDir,
      "run-ss-01",
      new TextEncoder().encode("Test prompt"),
      "file",
      true,
    );
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  describe("ingestScreenshots", () => {
    it("returns empty array when no screenshot candidates are discovered", () => {
      const records = ingestScreenshots({ runRoot: runDir, searchDirs: [] });
      expect(records).toEqual([]);
    });

    it("ingests explicit screenshots with attribution metadata", () => {
      const imgPath = join(sandboxDir, "ui-screen.png");
      fs.writeFileSync(imgPath, "fake-png-data-1", "utf-8");

      const records = ingestScreenshots({
        runRoot: runDir,
        explicitPaths: [imgPath],
        commandId: "cmd-123",
        taskId: "task-abc",
        actor: "validator-01",
      });

      expect(records).toHaveLength(1);
      expect(records[0]?.kind).toBe("screenshot");
      expect(records[0]?.name).toBe("ui-screen.png");
      expect(records[0]?.command_id).toBe("cmd-123");
      expect(records[0]?.task_id).toBe("task-abc");
      expect(records[0]?.actor).toBe("validator-01");

      const captures = readCaptures(runDir);
      expect(captures.some((c) => c.name === "ui-screen.png")).toBe(true);
    });

    it("deduplicates identical sha256 blobs and handles filename collisions", () => {
      const dirA = join(sandboxDir, "dirA");
      const dirB = join(sandboxDir, "dirB");
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      const file1 = join(dirA, "capture.png");
      const file2 = join(dirB, "capture.png");
      fs.writeFileSync(file1, "content-version-1", "utf-8");
      fs.writeFileSync(file2, "content-version-2", "utf-8");

      const firstPass = ingestScreenshots({
        runRoot: runDir,
        explicitPaths: [file1],
      });
      expect(firstPass).toHaveLength(1);
      expect(firstPass[0]?.name).toBe("capture.png");

      const secondPass = ingestScreenshots({
        runRoot: runDir,
        explicitPaths: [file1],
      });
      expect(secondPass).toHaveLength(0);

      const collisionPass = ingestScreenshots({
        runRoot: runDir,
        explicitPaths: [file2],
      });
      expect(collisionPass).toHaveLength(1);
      expect(collisionPass[0]?.name).toContain("capture-");
    });

    it("extracts and attributes images cited in stdout/stderr and timestamps", () => {
      const imgPath = join(sandboxDir, "cited-chart.png");
      fs.writeFileSync(imgPath, "chart-binary-data", "utf-8");

      const stdout = `Generated screenshot at: ![Chart](${imgPath})`;
      const stderr = `Warn: see ![Fallback](${imgPath})`;
      const records = ingestScreenshots({
        runRoot: runDir,
        searchDirs: [sandboxDir],
        stdout,
        stderr,
        startedAt: new Date(Date.now() - 10000).toISOString(),
        taskId: "task-cited",
      });

      expect(records).toHaveLength(1);
      expect(records[0]?.task_id).toBe("task-cited");

      const futureStarted = ingestScreenshots({
        runRoot: runDir,
        searchDirs: [sandboxDir],
        startedAt: new Date(Date.now() + 100000).toISOString(),
      });
      expect(futureStarted).toEqual([]);
    });
  });

  describe("ingestVisualReport", () => {
    it("returns null when no visual report candidates exist", () => {
      const report = ingestVisualReport({ runRoot: runDir, searchDirs: [] });
      expect(report).toBeNull();
    });

    it("ingests and normalizes valid visual report JSON files with citations", () => {
      const reportPath = join(sandboxDir, "visual-report.json");
      const reportData = {
        metrics: { totalScreenshots: 3, passRate: 1.0 },
        artifacts: ["a.png", "b.png"],
      };
      fs.writeFileSync(reportPath, JSON.stringify(reportData), "utf-8");

      const report = ingestVisualReport({
        runRoot: runDir,
        explicitPaths: [reportPath],
        stdout: `Report: [Visual](${reportPath})`,
        stderr: `Report stderr: [Visual](${reportPath})`,
        startedAt: new Date(Date.now() - 5000).toISOString(),
        commandId: "cmd-vis",
      });

      expect(report).not.toBeNull();
      const captures = readCaptures(runDir);
      expect(captures.some((c) => c.kind === "visual_report")).toBe(true);
    });

    it("skips invalid json and unnormalizable visual reports", () => {
      const corruptPath = join(sandboxDir, "broken-report.json");
      fs.writeFileSync(corruptPath, "{ corrupt json data", "utf-8");

      const report = ingestVisualReport({
        runRoot: runDir,
        explicitPaths: [corruptPath],
      });
      expect(report).toBeNull();

      const invalidSchemaPath = join(sandboxDir, "invalid-schema.json");
      fs.writeFileSync(invalidSchemaPath, JSON.stringify({ unsupported: true }), "utf-8");
      const reportInvalid = ingestVisualReport({
        runRoot: runDir,
        explicitPaths: [invalidSchemaPath],
      });
      expect(reportInvalid).toBeNull();
    });
  });
});

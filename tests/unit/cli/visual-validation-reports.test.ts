import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";
import {
  createMockScreenshot,
  readJsonFile,
  runGateExec,
  submitAndStartValidation,
} from "./visual-validation-fixture.ts";
import { getVisualReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import { ingestScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import type { VisualMetricsReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-types.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Automated Visual Validation & Screenshot Pipeline - Reports & Verification", () => {
  test("task:reject records screenshots in findings and reports during failure review", async () => {
    const { repo, run } = await setupCompiledRun("visual-reject", roots);
    createMockScreenshot(join(repo, "test-results"), "diff.png");
    const { valToken } = await submitAndStartValidation({
      run,
      repo,
      taskId: "task-core",
      worker: "w1",
      validator: "v1",
    });

    const exec = await runGateExec(run, repo, "task-core", "v1");
    const cmdId = String(exec.command_id);

    const reject = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "v1",
      "--token",
      valToken,
      "--evidence",
      cmdId,
      "--reason",
      "Visual overflow",
    ]);

    expect(reject.finding_id).toBe("finding-task-core-reject");
    const reportData = readJsonFile<{ screenshots: string[]; screenshot_records: unknown[] }>(
      join(run, "reports", "task-core-review.json"),
    );
    expect(Array.isArray(reportData.screenshots)).toBe(true);
    expect(Array.isArray(reportData.screenshot_records)).toBe(true);
    expect(reportData.screenshots.some((s) => s.includes("diff.png"))).toBe(true);
  });

  test("deterministic in-place screenshot overwrite updates files and deduplicates manifest.json", async () => {
    const { repo, run } = await setupCompiledRun("visual-overwrite", roots);
    const originalFile = createMockScreenshot(
      join(repo, "test-results"),
      "drawer-overview.png",
      "content-v1",
    );

    const firstIngested = ingestScreenshots({
      runRoot: run,
      taskId: "task-core",
      commandId: "cmd-fixed",
      searchDirs: [join(repo, "test-results")],
    });
    expect(firstIngested.length).toBe(1);

    const destEvidencePath = join(run, "evidence", "screenshots", "cmd-fixed-drawer-overview.png");
    expect(existsSync(destEvidencePath)).toBe(true);
    expect(readFileSync(destEvidencePath, "utf-8")).toBe("content-v1");

    const manifestBefore = readJsonFile<{
      screenshots: Array<{ name: string; size_bytes?: number }>;
    }>(join(run, "evidence", "manifest.json"));
    expect(
      manifestBefore.screenshots.filter((s) => s.name === "cmd-fixed-drawer-overview.png").length,
    ).toBe(1);

    writeFileSync(originalFile, "content-v2-updated-visuals", "utf-8");

    const secondIngested = ingestScreenshots({
      runRoot: run,
      taskId: "task-core",
      commandId: "cmd-fixed",
      searchDirs: [join(repo, "test-results")],
      overwrite: true,
    });
    expect(secondIngested.length).toBe(1);
    expect(readFileSync(destEvidencePath, "utf-8")).toBe("content-v2-updated-visuals");

    const manifestAfter = readJsonFile<{
      screenshots: Array<{ name: string; size_bytes?: number }>;
    }>(join(run, "evidence", "manifest.json"));
    const matchedEntries = manifestAfter.screenshots.filter(
      (s) => s.name === "cmd-fixed-drawer-overview.png",
    );
    expect(matchedEntries.length).toBe(1);
    expect(matchedEntries[0]?.size_bytes).toBe("content-v2-updated-visuals".length);
  });

  test("run:exec discovers and ingests visual-report.json into evidence and reports", async () => {
    const { repo, run } = await setupCompiledRun("visual-report-ingest", roots);
    const mockReport: VisualMetricsReport = {
      timestamp: "2026-08-15T19:00:00.000Z",
      viewports: {
        desktop: { width: 1280, height: 800, scrollWidth: 1280, scrollHeight: 800 },
        mobile: { width: 375, height: 667, scrollWidth: 410, scrollHeight: 667 },
      },
      layoutOverflows: [
        {
          element: "nav-bar",
          selector: ".top-nav",
          scrollWidth: 410,
          clientWidth: 375,
          delta: 35,
          viewport: "mobile",
        },
      ],
      textClippings: [
        {
          element: "heading",
          selector: "h1.title",
          text: "Very long title truncated",
          scrollWidth: 400,
          clientWidth: 350,
          viewport: "mobile",
        },
      ],
      collisions: [
        {
          elements: ["button#save", "div#overlay"],
          selectors: ["#save", "#overlay"],
          zIndex: 10,
          overlapArea: 120,
          viewport: "desktop",
        },
      ],
    };

    mkdirSync(join(repo, "test-results"), { recursive: true });
    writeFileSync(
      join(repo, "test-results", "visual-report.json"),
      JSON.stringify(mockReport, null, 2),
      "utf-8",
    );

    const exec = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "visual-pass",
    ]);

    expect(exec.exit_code).toBe(0);
    const parsedExecReport = exec.visual_report as VisualMetricsReport;
    expect(parsedExecReport).toBeDefined();
    expect(parsedExecReport.layoutOverflows.length).toBe(1);
    expect(parsedExecReport.layoutOverflows[0]?.delta).toBe(35);
    expect(parsedExecReport.textClippings.length).toBe(1);
    expect(parsedExecReport.collisions.length).toBe(1);

    expect(existsSync(join(run, "reports", "visual-report.json"))).toBe(true);
    expect(existsSync(join(run, "evidence", "visual-report.json"))).toBe(true);

    const retrieved = getVisualReport(run);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.viewports["desktop"]?.width).toBe(1280);
    expect(retrieved?.layoutOverflows[0]?.element).toBe("nav-bar");
  });

  test("task:review attaches visual_report to task review report", async () => {
    const { repo, run } = await setupCompiledRun("visual-review-attach", roots);
    const { valToken } = await submitAndStartValidation({
      run,
      repo,
      taskId: "task-core",
      worker: "w1",
      validator: "v1",
    });

    const mockReport: VisualMetricsReport = {
      timestamp: "2026-08-15T19:00:00.000Z",
      viewports: { desktop: { width: 1280, height: 800 } },
      layoutOverflows: [],
      textClippings: [],
      collisions: [],
    };

    mkdirSync(join(repo, "test-results"), { recursive: true });
    writeFileSync(
      join(repo, "test-results", "visual-report.json"),
      JSON.stringify(mockReport, null, 2),
      "utf-8",
    );

    const exec = await runGateExec(run, repo, "task-core", "v1");
    const cmdId = String(exec.command_id);

    const review = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      "task-core",
      "--validator",
      "v1",
      "--token",
      valToken,
      "--evidence",
      cmdId,
      "--status",
      "pass",
      "--summary",
      "Visual validation clean",
    ]);

    expect(review.verdict).toBe("pass");
    const reviewData = readJsonFile<{ visual_report?: VisualMetricsReport }>(
      join(run, "reports", "task-core-review.json"),
    );
    expect(reviewData.visual_report).toBeDefined();
    expect(reviewData.visual_report?.viewports["desktop"]?.width).toBe(1280);
  });
});

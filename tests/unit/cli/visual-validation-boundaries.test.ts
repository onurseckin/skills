import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./file-persistence-fixture.ts";
import {
  advanceRunToCritic,
  createMockScreenshot,
  readJsonFile,
} from "./visual-validation-fixture.ts";
import { getVisualReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import { ingestScreenshots } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts";
import type { VisualMetricsReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-types.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Automated Visual Validation - Boundaries & Resilience", () => {
  test("evidence:screenshots recovers gracefully when evidence/manifest.json is deleted", async () => {
    const { repo, run } = await setupCompiledRun("visual-manifest-del", roots);
    createMockScreenshot(join(repo, "test-results"), "recovered.png");

    await execute([
      "run:exec", "--run", run, "--task", "task-core", "--actor", "val-rec", "--cwd", repo, "--", "echo", "rec",
    ]);

    const manifestPath = join(run, "evidence", "manifest.json");
    if (existsSync(manifestPath)) unlinkSync(manifestPath);

    const recovered = await execute(["evidence:screenshots", "--run", run, "--task", "task-core"]);
    expect(Number(recovered.count)).toBeGreaterThanOrEqual(1);
    expect(String(recovered.markdown)).toContain("recovered.png");
  });

  test("report schema verification: task-review and critic-review populate screenshots schemas", async () => {
    const { repo, run } = await setupCompiledRun("visual-schema", roots);
    createMockScreenshot(join(repo, "test-results"), "schema-test.png");
    await advanceRunToCritic(run, repo, "task-core", "w1", "v1");

    const startCrit = await execute(["critic:start", "--run", run, "--critic", "crit-1"]);
    const critToken = startCrit.token as string;

    await execute([
      "run:exec", "--run", run, "--actor", "crit-1", "--cwd", repo, "--", "bun", "test", "tests",
    ]);

    await execute([
      "critic:review", "--run", run, "--critic", "crit-1", "--token", critToken,
      "--decision", "request_changes", "--summary", "Defects found in review",
    ]);

    const criticRep = readJsonFile<{ screenshots: string[]; screenshot_records: unknown[] }>(
      join(run, "reports", "critic-review.json"),
    );
    expect(Array.isArray(criticRep.screenshots)).toBe(true);
    expect(Array.isArray(criticRep.screenshot_records)).toBe(true);
    expect(criticRep.screenshots.some((s) => s.includes("schema-test.png"))).toBe(true);
  });

  test("boundary: nested directory scanning discovers deep screenshots", async () => {
    const { repo, run } = await setupCompiledRun("visual-nested", roots);
    const deepDir = join(repo, "test-results", "nested", "level2", "deep");
    createMockScreenshot(deepDir, "deep-screen.png");

    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "deep",
    ]);
    const cmdId = String(exec.command_id);
    expect(existsSync(join(run, "evidence", "screenshots", `${cmdId}-deep-screen.png`))).toBe(true);
  });

  test("boundary: duplicate image filenames across multiple commands preserve unique cmd-id prefixes", async () => {
    const { repo, run } = await setupCompiledRun("visual-duplicate", roots);
    createMockScreenshot(join(repo, "test-results"), "component.png", "data-v1");

    const exec1 = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "1",
    ]);
    const cmd1 = String(exec1.command_id);

    createMockScreenshot(join(repo, "test-results"), "component.png", "data-v2");
    const exec2 = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "2",
    ]);
    const cmd2 = String(exec2.command_id);

    expect(cmd1).not.toBe(cmd2);
    expect(existsSync(join(run, "evidence", "screenshots", `${cmd1}-component.png`))).toBe(true);
    expect(existsSync(join(run, "evidence", "screenshots", `${cmd2}-component.png`))).toBe(true);
  });

  test("boundary: non-image files are filtered and ignored during screenshot scanning", async () => {
    const { repo, run } = await setupCompiledRun("visual-filter", roots);
    const testResultsDir = join(repo, "test-results");
    mkdirSync(testResultsDir, { recursive: true });
    writeFileSync(join(testResultsDir, "test.txt"), "text", "utf-8");
    writeFileSync(join(testResultsDir, "report.json"), "{}", "utf-8");
    writeFileSync(join(testResultsDir, "debug.log"), "logs", "utf-8");

    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "filter",
    ]);
    const screenshots = exec.screenshots as string[];
    expect(screenshots.length).toBe(0);
  });

  test("boundary: non-existent search directories are gracefully handled with 0 screenshots", async () => {
    const { repo, run } = await setupCompiledRun("visual-nonexist", roots);
    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "clean",
    ]);
    const screenshots = exec.screenshots as string[];
    expect(screenshots.length).toBe(0);
  });

  test("error resilience: read-only or failed destination copy does not crash execution", async () => {
    const { repo, run } = await setupCompiledRun("visual-resilience", roots);
    createMockScreenshot(join(repo, "test-results"), "resilient.png");

    const evScreenshotsDir = join(run, "evidence", "screenshots");
    mkdirSync(evScreenshotsDir, { recursive: true });
    try {
      chmodSync(evScreenshotsDir, 0o444);
    } catch {}

    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "safe",
    ]);
    expect(exec.exit_code).toBe(0);

    try {
      chmodSync(evScreenshotsDir, 0o777);
    } catch {}
  });

  test("boundary: malformed visual-report.json is handled gracefully without failing execution", async () => {
    const { repo, run } = await setupCompiledRun("visual-malformed", roots);
    const testResultsDir = join(repo, "test-results");
    mkdirSync(testResultsDir, { recursive: true });
    writeFileSync(join(testResultsDir, "visual-report.json"), "NOT_JSON_DATA {{{", "utf-8");

    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "malformed-test",
    ]);
    expect(exec.exit_code).toBe(0);
    expect(exec.visual_report).toBeUndefined();
    expect(getVisualReport(run)).toBeNull();
  });

  test("boundary: visual-report.json with empty or partial object is normalized with defaults", async () => {
    const { repo, run } = await setupCompiledRun("visual-partial", roots);
    const testResultsDir = join(repo, "test-results");
    mkdirSync(testResultsDir, { recursive: true });
    writeFileSync(join(testResultsDir, "visual-report.json"), JSON.stringify({}), "utf-8");

    const exec = await execute([
      "run:exec", "--run", run, "--task", "task-core", "--cwd", repo, "--", "echo", "partial-test",
    ]);
    expect(exec.exit_code).toBe(0);
    const rep = exec.visual_report as VisualMetricsReport;
    expect(rep).toBeDefined();
    expect(Array.isArray(rep.layoutOverflows)).toBe(true);
    expect(rep.layoutOverflows.length).toBe(0);
    expect(Array.isArray(rep.textClippings)).toBe(true);
    expect(Array.isArray(rep.collisions)).toBe(true);
    expect(typeof rep.viewports).toBe("object");
  });

  test("boundary: getVisualReport handles empty object, non-object, and array schemas gracefully", async () => {
    const { run } = await setupCompiledRun("visual-fallback-schemas", roots);
    const repDir = join(run, "reports");
    mkdirSync(repDir, { recursive: true });

    writeFileSync(join(repDir, "visual-report.json"), "[\"invalid\", \"array\"]", "utf-8");
    expect(getVisualReport(run)).toBeNull();

    writeFileSync(join(repDir, "visual-report.json"), "\"string-primitive\"", "utf-8");
    expect(getVisualReport(run)).toBeNull();

    writeFileSync(join(repDir, "visual-report.json"), "{}", "utf-8");
    const normalized = getVisualReport(run);
    expect(normalized).not.toBeNull();
    expect(normalized?.layoutOverflows).toEqual([]);
    expect(normalized?.textClippings).toEqual([]);
    expect(normalized?.collisions).toEqual([]);
    expect(typeof normalized?.viewports).toBe("object");
  });

  test("boundary: duplicate explicitPaths do not cause redundant filesystem writes", async () => {
    const { repo, run } = await setupCompiledRun("visual-dup-explicit", roots);
    const imgPath = createMockScreenshot(join(repo, "test-results"), "dup-test.png", "raw-bytes");

    const ingested = ingestScreenshots({
      runRoot: run,
      commandId: "cmd-dup",
      explicitPaths: [imgPath, imgPath, join(repo, "test-results", "dup-test.png")],
    });
    expect(ingested.length).toBe(1);

    const manifest = readJsonFile<{ screenshots: Array<{ name: string }> }>(
      join(run, "evidence", "manifest.json"),
    );
    expect(manifest.screenshots.filter((s) => s.name === "cmd-dup-dup-test.png").length).toBe(1);
  });

  test("boundary: ingestScreenshots with overwrite: false skips existing destination files", async () => {
    const { repo, run } = await setupCompiledRun("visual-no-overwrite", roots);
    createMockScreenshot(join(repo, "test-results"), "static.png", "initial-data");

    const res1 = ingestScreenshots({
      runRoot: run,
      commandId: "cmd-static",
      searchDirs: [join(repo, "test-results")],
    });
    expect(res1.length).toBe(1);

    const destPath = join(run, "evidence", "screenshots", "cmd-static-static.png");
    expect(readFileSync(destPath, "utf-8")).toBe("initial-data");

    writeFileSync(join(repo, "test-results", "static.png"), "modified-data", "utf-8");

    const res2 = ingestScreenshots({
      runRoot: run,
      commandId: "cmd-static",
      searchDirs: [join(repo, "test-results")],
      overwrite: false,
    });
    expect(res2.length).toBe(0);
    expect(readFileSync(destPath, "utf-8")).toBe("initial-data");
  });

  test("boundary: getVisualReport returns null when reports and evidence directories have no visual-report", async () => {
    const { run } = await setupCompiledRun("visual-no-report", roots);
    expect(getVisualReport(run)).toBeNull();
  });
});

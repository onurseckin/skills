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
  writeScreenshotArgv,
} from "./visual-validation-fixture.ts";
import { getVisualReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts";
import { readCaptures } from "../../../orchestrating-long-tasks/scripts/src/store/captures.ts";
import type { VisualMetricsReport } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-types.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Automated Visual Validation - Boundaries & Resilience", () => {
  test("deleting the derived catalogue loses no capture, because it is only a cache", async () => {
    const { repo, run } = await setupCompiledRun("visual-index-del", roots);

    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "val-rec",
      "--cwd",
      repo,
      "--",
      ...writeScreenshotArgv(join(repo, "test-results"), "recovered.png"),
    ]);

    const indexPath = join(run, "index.json");
    expect(existsSync(indexPath)).toBe(true);
    unlinkSync(indexPath);

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
      "run:exec",
      "--run",
      run,
      "--actor",
      "crit-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "test",
      "tests",
    ]);
    await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "crit-1",
      "--token",
      critToken,
      "--decision",
      "request_changes",
      "--summary",
      "Defects found in review",
      "--findings",
      JSON.stringify([
        {
          id: "F-VISUAL-01",
          requirement_id: "req-core",
          severity: "important",
          observation: "The rendered panel does not match the captured screenshot",
          remediation: "Align the panel layout with the approved capture",
          revalidation: "bun test tests",
        },
      ]),
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

    const exec = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      ...writeScreenshotArgv(deepDir, "deep-screen.png"),
    ]);
    expect(exec.exit_code).toBe(0);
    expect(existsSync(join(run, "evidence", "screenshots", "deep-screen.png"))).toBe(true);
  });

  test("boundary: two different images under one file name are both kept, named by content", async () => {
    const { repo, run } = await setupCompiledRun("visual-duplicate", roots);
    const shots = join(repo, "test-results");

    const exec1 = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      ...writeScreenshotArgv(shots, "component.png", "data-v1"),
    ]);
    const exec2 = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      ...writeScreenshotArgv(shots, "component.png", "data-v2"),
    ]);

    expect(exec1.command_id).not.toBe(exec2.command_id);
    const captures = readCaptures(run);
    expect(captures).toHaveLength(2);
    expect(new Set(captures.map((capture) => capture.sha256)).size).toBe(2);
    // The first keeps the readable name; the second is disambiguated by its own digest, never by
    // the id of the command that ingested it.
    expect(captures[0]?.name).toBe("component.png");
    expect(captures[1]?.name).toBe(`component-${captures[1]!.sha256.slice(0, 8)}.png`);
    for (const capture of captures) expect(existsSync(join(run, capture.path))).toBe(true);
  });

  test("boundary: non-image files are filtered and ignored during screenshot scanning", async () => {
    const { repo, run } = await setupCompiledRun("visual-filter", roots);
    const testResultsDir = join(repo, "test-results");
    mkdirSync(testResultsDir, { recursive: true });
    writeFileSync(join(testResultsDir, "test.txt"), "text", "utf-8");
    writeFileSync(join(testResultsDir, "report.json"), "{}", "utf-8");
    writeFileSync(join(testResultsDir, "debug.log"), "logs", "utf-8");

    const exec = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "filter",
    ]);
    const screenshots = exec.screenshots as string[];
    expect(screenshots.length).toBe(0);
  });

  test("boundary: non-existent search directories are gracefully handled with 0 screenshots", async () => {
    const { repo, run } = await setupCompiledRun("visual-nonexist", roots);
    const exec = await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "clean",
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
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "safe",
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
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "malformed-test",
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
      "run:exec",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--task",
      "task-core",
      "--cwd",
      repo,
      "--",
      "echo",
      "partial-test",
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
});

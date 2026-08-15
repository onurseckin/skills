import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
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

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("Automated Visual Validation & Screenshot Pipeline", () => {
  test("run:exec detects screenshots in test-results, copies to evidence and reports, updates manifest", async () => {
    const { repo, run } = await setupCompiledRun("visual-exec", roots);
    createMockScreenshot(join(repo, "test-results"), "button.png");

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
      "run",
    ]);
    const cmdId = String(exec.command_id);
    expect(exec.exit_code).toBe(0);

    const screenshots = exec.screenshots as string[];
    expect(screenshots.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(run, "evidence", "screenshots", `${cmdId}-button.png`))).toBe(true);
    expect(existsSync(join(run, "reports", "screenshots", `${cmdId}-button.png`))).toBe(true);

    const evJson = readJsonFile<Record<string, unknown>>(join(run, "evidence", `${cmdId}.json`));
    expect(Array.isArray(evJson.screenshots)).toBe(true);

    const manifest = readJsonFile<{ screenshots: Array<{ name: string }> }>(
      join(run, "evidence", "manifest.json"),
    );
    expect(manifest.screenshots.some((s) => s.name.includes("button.png"))).toBe(true);
  });

  test("run:exec ingests screenshots referenced in command stdout", async () => {
    const { repo, run } = await setupCompiledRun("visual-stdout", roots);
    createMockScreenshot(join(repo, "screenshots"), "modal.png");
    writeFileSync(
      join(repo, "script.ts"),
      `console.log("Screenshot: screenshots/modal.png");\n`,
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
      "bun",
      "script.ts",
    ]);
    const screenshots = exec.screenshots as string[];
    expect(screenshots.some((s) => s.includes("modal.png"))).toBe(true);
  });

  test("evidence:screenshots queries and filters captured UI screenshots", async () => {
    const { repo, run } = await setupCompiledRun("visual-query", roots);
    createMockScreenshot(join(repo, "test-results"), "view.png");

    const exec = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "actor-a",
      "--cwd",
      repo,
      "--",
      "echo",
      "done",
    ]);
    const cmdId = String(exec.command_id);

    const all = await execute(["evidence:screenshots", "--run", run]);
    expect(Number(all.count)).toBeGreaterThanOrEqual(1);
    expect(String(all.markdown)).toContain("### Run Screenshots:");

    const byTask = await execute(["evidence:screenshots", "--run", run, "--task", "task-core"]);
    expect(Number(byTask.count)).toBeGreaterThanOrEqual(1);

    const empty = await execute(["evidence:screenshots", "--run", run, "--task", "nonexistent"]);
    expect(Number(empty.count)).toBe(0);

    const byCmd = await execute(["evidence:screenshots", "--run", run, "--command", cmdId]);
    expect(Number(byCmd.count)).toBeGreaterThanOrEqual(1);

    const byActor = await execute(["evidence:screenshots", "--run", run, "--actor", "actor-a"]);
    expect(Number(byActor.count)).toBeGreaterThanOrEqual(1);

    const byTaskActor = await execute([
      "evidence:screenshots",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "actor-a",
    ]);
    expect(Number(byTaskActor.count)).toBeGreaterThanOrEqual(1);

    const wrongActor = await execute([
      "evidence:screenshots",
      "--run",
      run,
      "--task",
      "task-core",
      "--actor",
      "wrong-actor",
    ]);
    expect(Number(wrongActor.count)).toBe(0);
  });

  test("evidence:get and report:get support --screenshots inspection flag and handle empty screenshots", async () => {
    const { repo, run } = await setupCompiledRun("visual-flags", roots);
    createMockScreenshot(join(repo, "screenshots"), "header.png");
    const { valToken } = await submitAndStartValidation({
      run,
      repo,
      taskId: "task-core",
      worker: "w1",
      validator: "v1",
    });

    const getSubRep = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--submission",
      "--screenshots",
    ]);
    expect(Array.isArray(getSubRep.screenshots)).toBe(true);
    expect((getSubRep.screenshots as string[]).length).toBe(0);
    expect(String(getSubRep.markdown)).toContain("0 captured");

    const exec = await runGateExec(run, repo, "task-core", "v1");
    const cmdId = String(exec.command_id);

    await execute([
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
      "passed",
    ]);

    const getEv = await execute(["evidence:get", "--run", run, "--id", cmdId, "--screenshots"]);
    expect(Array.isArray(getEv.screenshots)).toBe(true);
    expect(String(getEv.markdown)).toContain("Screenshots");

    const listEv = await execute(["evidence:get", "--run", run, "--screenshots"]);
    expect(Number(listEv.count)).toBeGreaterThanOrEqual(1);

    const getRep = await execute([
      "report:get",
      "--run",
      run,
      "--task",
      "task-core",
      "--screenshots",
    ]);
    expect(Array.isArray(getRep.screenshots)).toBe(true);

    const listRep = await execute(["report:get", "--run", run, "--screenshots"]);
    expect(Number(listRep.count)).toBeGreaterThanOrEqual(1);
  });

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
});

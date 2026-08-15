import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";
import { plannedFixture } from "./scenario-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function advanceToValidation(fixture: { run: string; repo: string; reportPath: string }) {
  const claim = await execute([
    "claim",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--agent",
    "worker",
    "--role",
    "implementer",
  ]);
  await execute([
    "packet",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--role",
    "implementer",
    "--agent",
    "worker",
    "--token",
    claim.token as string,
    "--id",
    "task-1-impl",
  ]);
  await execute([
    "submit",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--agent",
    "worker",
    "--token",
    claim.token as string,
    "--report",
    fixture.reportPath,
  ]);
  const valStart = await execute([
    "begin-validation",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--validator",
    "val-1",
  ]);
  await execute([
    "packet",
    "--run",
    fixture.run,
    "--task",
    "task-1",
    "--role",
    "validator",
    "--agent",
    "val-1",
    "--token",
    valStart.token as string,
    "--id",
    "task-1-val-1",
  ]);
  return { valToken: valStart.token as string };
}

describe("CLI workflow review and execution commands", () => {
  test("submit, validation, review, and recover lifecycle", async () => {
    const fixture = await plannedFixture(roots);
    const { valToken } = await advanceToValidation(fixture);

    const cmdResult = await execute([
      "run",
      "--run",
      fixture.run,
      "--actor",
      "val-1",
      "--cwd",
      fixture.repo,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--",
      "bun",
      "gate-check.ts",
    ]);
    const checkCommandId = (cmdResult.record as { id: string }).id;

    const reviewPath = await writeJson(fixture.repo, "val-review.json", {
      verdict: "pass",
      requirement_ids: ["R-001"],
      checks: [{ command_id: checkCommandId }],
      findings: [],
    });
    const reviewed = await execute([
      "review",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "val-1",
      "--token",
      valToken,
      "--review",
      reviewPath,
    ]);
    expect((reviewed.task as { status: string }).status).toBe("validated");

    const rec1 = await execute([
      "recover",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "60",
    ]);
    expect(rec1.run_root).toBe(fixture.run);

    const rec2 = await execute(["recover", "--run", fixture.run, "--actor", "coordinator"]);
    expect(rec2.run_root).toBe(fixture.run);
  });

  test("gate and finish commands transition task to done", async () => {
    const fixture = await plannedFixture(roots);
    const { valToken } = await advanceToValidation(fixture);

    const valCmd = await execute([
      "run",
      "--run",
      fixture.run,
      "--actor",
      "val-1",
      "--cwd",
      fixture.repo,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--",
      "bun",
      "gate-check.ts",
    ]);
    const checkId = (valCmd.record as { id: string }).id;

    const reviewPath = await writeJson(fixture.repo, "val-rev.json", {
      verdict: "pass",
      requirement_ids: ["R-001"],
      checks: [{ command_id: checkId }],
      findings: [],
    });
    await execute([
      "review",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--validator",
      "val-1",
      "--token",
      valToken,
      "--review",
      reviewPath,
    ]);

    const runResult = await execute([
      "run",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--cwd",
      fixture.repo,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--",
      "bun",
      "gate-check.ts",
    ]);
    const commandId = (runResult.record as { id: string }).id;

    const gateRes = await execute([
      "gate",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--command-id",
      commandId,
      "--actor",
      "coordinator",
    ]);
    expect((gateRes.task as { status: string }).status).toBe("gating");

    const finishRes = await execute([
      "finish",
      "--run",
      fixture.run,
      "--task",
      "task-1",
      "--actor",
      "coordinator",
    ]);
    expect((finishRes.task as { status: string }).status).toBe("done");
  });
});

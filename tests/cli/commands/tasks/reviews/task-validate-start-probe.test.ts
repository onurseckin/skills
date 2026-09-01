import { afterAll, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskValidateStartCommand } from "../../../../../olt/scripts/src/cli/commands/task-validation-start.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import {
  CHANGED_FILE,
  TASK_ID,
  VALIDATOR,
  claimSubmitValidate,
  recordProbe,
  runGate,
  setupRun,
} from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("task:validate-start", () => {
  test("refuses an unrecognised --validator-domain", async () => {
    await expect(
      taskValidateStartCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        "validator-domain": "not-a-domain",
      }),
    ).rejects.toThrow(/not a recognized validator domain/);
  });

  test("accepts an explicit --validator-domain and reports its mandatory gates", async () => {
    const { repo, run } = await setupRun("validate-start-domain", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);
    await Bun.write(
      `${repo}/${CHANGED_FILE}`,
      "export const probed = true;\nexport const x = 1;\n",
    );
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--actor",
      "worker-1",
      "--cwd",
      repo,
      "--",
      "echo",
      "implementer-work",
    ]);
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-1",
      "--token",
      claim.token as string,
      "--files-changed",
      CHANGED_FILE,
      "--summary",
      "did the work",
    ]);
    const val = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--validator-domain",
      "code-quality",
    ]);
    expect(typeof val.token).toBe("string");
    expect(String(val.markdown)).toContain(TASK_ID);
  });
});

describe("task:probe", () => {
  test("records a probe demand, keeps task validating, and round starts at 1", async () => {
    const { repo, run } = await setupRun("probe-basic", roots);
    const validation = await claimSubmitValidate(repo, run);
    const probed = await recordProbe(
      run,
      validation.token as string,
      "Prove the change is exercised by a test",
    );
    expect(probed.probe_round).toBe(1);
    expect((probed.task as { status: string }).status).toBe("validating");
    expect((probed.finding_ids as string[]).length).toBe(1);
    expect(String(probed.markdown)).toContain(TASK_ID);
  });

  test("--evidence attaches cited command ids instead of bare demand statement", async () => {
    const { repo, run } = await setupRun("probe-evidence", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it with the gate");
    expect(probed.probe_round).toBe(1);
    const secondProbe = await execute([
      "task:probe",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      validation.token as string,
      "--demand",
      "Prove it a second way",
      "--evidence",
      gateCmd,
    ]);
    expect(secondProbe.probe_round).toBe(2);
  });
});

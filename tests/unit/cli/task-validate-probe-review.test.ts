import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadChecklist } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import {
  CHANGED_FILE,
  TASK_ID,
  VALIDATOR,
  answeredBy,
  claimSubmitValidate,
  recordProbe,
  reviewPass,
  runGate,
  setupRun,
} from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:validate-start", () => {
  test("refuses an unrecognised --validator-domain", async () => {
    const { repo, run } = await setupRun("validate-start-bad-domain", roots);
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
    await expect(
      execute([
        "task:validate-start",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--validator",
        VALIDATOR,
        "--validator-domain",
        "not-a-domain",
      ]),
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
  test("records a probe demand, keeps the task validating, and its round starts at 1", async () => {
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

  test("--evidence attaches cited command ids instead of a bare demand statement", async () => {
    const { repo, run } = await setupRun("probe-evidence", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it with the gate");
    expect(probed.probe_round).toBe(1);
    // Second probe demand, now citing the gate's command id as evidence.
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

describe("task:review", () => {
  test("a pass is refused while the mandatory probe round is short, and refused with an unresolved finding", async () => {
    const { repo, run } = await setupRun("review-preconditions", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");

    await expect(execute(reviewPass(run, validation.token as string, gateCmd))).rejects.toThrow(
      /adversarial probe/,
    );

    const probed = await recordProbe(run, validation.token as string, "Prove it works");
    await expect(execute(reviewPass(run, validation.token as string, gateCmd))).rejects.toThrow(
      /open finding/,
    );

    const passed = await execute(
      reviewPass(run, validation.token as string, gateCmd, answeredBy(probed.finding_ids, gateCmd)),
    );
    expect(passed.verdict).toBe("pass");
    expect((passed.task as { status: string }).status).toBe("done");
    expect((passed.resolved_findings as unknown[]).length).toBe(1);
  });

  test("--status fail requires --summary/--severity/--remediation and refuses --resolve on a fail", async () => {
    const { repo, run } = await setupRun("review-fail-required-fields", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");

    await expect(
      execute([
        "task:review",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--validator",
        VALIDATOR,
        "--token",
        validation.token as string,
        "--status",
        "fail",
      ]),
    ).rejects.toThrow(/--summary is required for a failing verdict/);

    await expect(
      execute([
        "task:review",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--validator",
        VALIDATOR,
        "--token",
        validation.token as string,
        "--status",
        "fail",
        "--summary",
        "it is broken",
        "--severity",
        "critical",
        "--remediation",
        "fix it",
        "--resolve",
        "finding-x=cmd-1",
      ]),
    ).rejects.toThrow(/applies to a passing verdict only/);

    const failed = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      validation.token as string,
      "--status",
      "fail",
      "--summary",
      "it is broken",
      "--severity",
      "critical",
      "--remediation",
      "fix it",
      "--evidence",
      gateCmd,
    ]);
    expect(failed.verdict).toBe("fail");
    expect((failed.task as { status: string }).status).toBe("changes_requested");
    expect(failed.finding_id).toBeDefined();
  });

  test("--status must be pass or fail", async () => {
    const { repo, run } = await setupRun("review-bad-status", roots);
    const validation = await claimSubmitValidate(repo, run);
    await expect(
      execute([
        "task:review",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--validator",
        VALIDATOR,
        "--token",
        validation.token as string,
        "--status",
        "maybe",
      ]),
    ).rejects.toThrow(/--status must be pass or fail/);
  });

  test("--checklist-domain and --checklist-report must be given together, and the domain must be recognised", async () => {
    const { repo, run } = await setupRun("review-checklist-flags", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");

    await expect(
      execute([
        ...reviewPass(
          run,
          validation.token as string,
          gateCmd,
          answeredBy(probed.finding_ids, gateCmd),
        ),
        "--checklist-domain",
        "code-quality",
      ]),
    ).rejects.toThrow(/must be given together/);

    await expect(
      execute([
        ...reviewPass(
          run,
          validation.token as string,
          gateCmd,
          answeredBy(probed.finding_ids, gateCmd),
        ),
        "--checklist-domain",
        "not-a-real-domain",
        "--checklist-report",
        `${repo}/coverage.json`,
      ]),
    ).rejects.toThrow(/not a recognized validator domain/);
  });

  test("--checklist-report that cannot be read, and one that is not valid JSON, are both refused", async () => {
    const { repo, run } = await setupRun("review-checklist-report-errors", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");

    await expect(
      execute([
        ...reviewPass(
          run,
          validation.token as string,
          gateCmd,
          answeredBy(probed.finding_ids, gateCmd),
        ),
        "--checklist-domain",
        "code-quality",
        "--checklist-report",
        `${repo}/does-not-exist.json`,
      ]),
    ).rejects.toThrow(/--checklist-report is unreadable/);

    await Bun.write(`${repo}/malformed.json`, "{ not valid json");
    await expect(
      execute([
        ...reviewPass(
          run,
          validation.token as string,
          gateCmd,
          answeredBy(probed.finding_ids, gateCmd),
        ),
        "--checklist-domain",
        "code-quality",
        "--checklist-report",
        `${repo}/malformed.json`,
      ]),
    ).rejects.toThrow(/--checklist-report is not valid JSON/);
  });

  test("with no --evidence/--checks given, the check ids are auto-derived from the validator's own recorded commands", async () => {
    const { repo, run } = await setupRun("review-auto-derived-evidence", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");

    const passed = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      validation.token as string,
      "--resolve",
      `${(probed.finding_ids as string[])[0]!}=${gateCmd}`,
      "--status",
      "pass",
      "--summary",
      "All unit tests pass",
    ]);
    expect(passed.verdict).toBe("pass");
    expect((passed.task as { status: string }).status).toBe("done");
  });

  test("a valid --checklist-domain/--checklist-report pair is accepted and reported", async () => {
    const { repo, run } = await setupRun("review-checklist-valid", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");
    const coveragePath = `${repo}/coverage.json`;
    const checklist = loadChecklist("code-quality");
    await Bun.write(
      coveragePath,
      JSON.stringify({
        items: checklist.items.map((item) => ({
          id: item.id,
          disposition: "not_applicable",
          reason: "exercised by the fixture task, not this checklist item",
        })),
      }),
    );

    const passed = await execute([
      ...reviewPass(
        run,
        validation.token as string,
        gateCmd,
        answeredBy(probed.finding_ids, gateCmd),
      ),
      "--checklist-domain",
      "code-quality",
      "--checklist-report",
      coveragePath,
    ]);
    expect((passed.checklist_coverage as { applicable: boolean }).applicable).toBe(true);
  });
});

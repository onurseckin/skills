import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { taskReviewCommand } from "../../../olt/scripts/src/cli/commands/task-review.ts";
import { taskValidateStartCommand } from "../../../olt/scripts/src/cli/commands/task-validation-start.ts";
import { loadChecklist } from "../../../olt/scripts/src/packets/role-contract.ts";
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
  seedGateProof,
  setupRun,
} from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("task:validate-start", () => {
  test("refuses an unrecognised --validator-domain", async () => {
    // The domain check runs before the command ever opens the run root, so no capsule is needed
    // to exercise it — see taskValidateStartCommand, which validates --validator-domain first.
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
    seedGateProof(run, TASK_ID);

    await expect(execute(reviewPass(run, validation.token as string, gateCmd))).rejects.toThrow(
      /Cognitive deepening protocol not satisfied|required cognitive rounds|adversarial probe/,
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
    // Both refusals happen inside taskReviewCommand before it ever opens the run root
    // (assertNoResolutions / failingVerdictInput run ahead of loadRun), so they need no capsule.
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "fail",
      }),
    ).rejects.toThrow(/--summary is required for a failing verdict/);

    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "fail",
        summary: "it is broken",
        severity: "critical",
        remediation: "fix it",
        resolve: "finding-x=cmd-1",
      }),
    ).rejects.toThrow(/applies to a passing verdict only/);

    const { repo, run } = await setupRun("review-fail-required-fields", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");

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
    // Pure flag validation ahead of loadRun — no task, no capsule required to reach it.
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "maybe",
      }),
    ).rejects.toThrow(/--status must be pass or fail/);
  });

  test("--checklist-domain and --checklist-report must be given together, and the domain must be recognised", async () => {
    // resolveChecklistCoverage runs before loadRun, so neither assertion needs a capsule.
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "code-quality",
      }),
    ).rejects.toThrow(/must be given together/);

    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "not-a-real-domain",
        "checklist-report": "/does-not-matter/coverage.json",
      }),
    ).rejects.toThrow(/not a recognized validator domain/);
  });

  test("--checklist-report that cannot be read, and one that is not valid JSON, are both refused", async () => {
    // Both refusals also run before loadRun; only the malformed-JSON case needs a real file on
    // disk (to prove it was actually read), so this needs a lone scratch file, not a capsule.
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "code-quality",
        "checklist-report": "/definitely/does/not/exist-xyz.json",
      }),
    ).rejects.toThrow(/--checklist-report is unreadable/);

    const scratchDir = await mkdtemp(join(tmpdir(), "harness-checklist-report-"));
    roots.push(scratchDir);
    const malformedPath = join(scratchDir, "malformed.json");
    await Bun.write(malformedPath, "{ not valid json");
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "code-quality",
        "checklist-report": malformedPath,
      }),
    ).rejects.toThrow(/--checklist-report is not valid JSON/);
  });

  test("with no --evidence/--checks given, the check ids are auto-derived from the validator's own recorded commands", async () => {
    const { repo, run } = await setupRun("review-auto-derived-evidence", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");
    seedGateProof(run, TASK_ID);

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
    seedGateProof(run, TASK_ID);
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

  test("task:validate-start accepts --lease-duration flag", async () => {
    const { repo, run } = await setupRun("validate-start-lease", roots);
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
      "export const probed = true;\nexport const modified = true;\n",
    );
    const gateCmd = await runGate(repo, run, "gate-core.ts");
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
      "--evidence",
      gateCmd,
      "--summary",
      "Implemented probe target",
    ]);

    const val = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--lease-duration",
      "3600",
    ]);
    expect(val.token).toBeDefined();
  });

  test("task:review enforces paired_validator_id authorization (assertValidReviewer)", async () => {
    const { assertValidReviewer } =
      await import("../../../olt/scripts/src/cli/commands/task-review.ts");

    const taskWithPairedValidator: TaskRecord = {
      id: TASK_ID,
      status: "validating",
      requirement_ids: [],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      lease: {
        agent_id: "worker-1",
        role: "implementer",
        paired_validator_id: "val-assigned-only",
        token: "token-1",
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    };

    // Unauthorized validator throws HarnessError
    expect(() =>
      assertValidReviewer("val-different-unauthorized", taskWithPairedValidator),
    ).toThrow(
      /Reviewer Authorization Failed: Caller 'val-different-unauthorized' is not the assigned paired validator \('val-assigned-only'\)/,
    );

    // Authorized validator passes cleanly
    expect(() => assertValidReviewer("val-assigned-only", taskWithPairedValidator)).not.toThrow();

    // Task without paired_validator_id allows any caller
    const taskWithoutPair: TaskRecord = {
      ...taskWithPairedValidator,
      lease: undefined,
    };
    expect(() => assertValidReviewer("any-validator", taskWithoutPair)).not.toThrow();
  });

  test("task:review rejects superficial rubber-stamp / generic sign-offs", async () => {
    const { repo, run } = await setupRun("review-rubber-stamp", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const probed = await recordProbe(run, validation.token as string, "Prove it");
    seedGateProof(run, TASK_ID);

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
        "--resolve",
        `${(probed.finding_ids as string[])[0]!}=${gateCmd}`,
        "--status",
        "pass",
        "--summary",
        "LGTM",
      ]),
    ).rejects.toThrow(/validator summary cannot be a superficial rubber-stamp/);
  });

  test("task:review supports micro-cycle critique when --status fail and --micro-cycle are specified", async () => {
    const { repo, run } = await setupRun("review-micro-cycle", roots);
    const validation = await claimSubmitValidate(repo, run);

    const result = await execute([
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
      "Micro-cycle critique: edge case uncovered",
      "--severity",
      "important",
      "--remediation",
      "Handle null payload gracefully",
      "--micro-cycle",
      "--max-rounds",
      "5",
    ]);

    expect(result.micro_cycle).toBe(true);
    expect(result.round).toBe(1);
  });

  test("task:review records structured failing verdict and supports --kind flag", async () => {
    const { repo, run } = await setupRun("review-fail-verdict", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");

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
      "Critical security regression detected in auth handler",
      "--severity",
      "critical",
      "--remediation",
      "Add permission check before DB query",
      "--finding-id",
      "finding-sec-01",
      "--checks",
      gateCmd,
      "--kind",
      "adversarial",
    ]);

    expect(failed.verdict).toBe("fail");
    expect(failed.finding_id).toBe("finding-sec-01");
    expect((failed.task as { status: string }).status).toBe("changes_requested");
  });
});

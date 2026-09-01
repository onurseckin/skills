import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskReviewCommand } from "../../../../../olt/scripts/src/cli/commands/task-review.ts";
import { loadChecklist } from "../../../../../olt/scripts/src/packets/role-contract.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import {
  TASK_ID,
  VALIDATOR,
  answeredBy,
  claimSubmitValidate,
  recordProbe,
  reviewPass,
  runGate,
  seedGateProof,
  setupRun,
} from "../../fixtures/probe-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("task:review - Preconditions, Status & Checklists", () => {
  test("pass refused while probe round short and with unresolved finding", async () => {
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

  test("--status fail requires fields and refuses --resolve", async () => {
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

  test("verifies --checklist-domain and --checklist-report requirements", async () => {
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

  test("records checklist coverage into validation record", async () => {
    const { repo, run } = await setupRun("review-checklist-coverage", roots);
    const validation = await claimSubmitValidate(repo, run);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    seedGateProof(run, TASK_ID);
    const probed = await recordProbe(run, validation.token as string, "Prove with checklist");

    const checklist = loadChecklist("code-quality");
    const scratchDir = await mkdtemp(join(tmpdir(), "harness-checklist-report-"));
    roots.push(scratchDir);
    const reportPath = join(scratchDir, "coverage.json");
    await writeFile(
      reportPath,
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
      reportPath,
    ]);

    expect((passed.checklist_coverage as { applicable: boolean }).applicable).toBe(true);
  });
});

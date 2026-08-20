import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { resetHarnessConfigCache } from "../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import {
  answeredBy,
  claimSubmitValidate,
  recordProbe,
  reviewPass,
  runGate,
  setupRun,
  TASK_ID,
  VALIDATOR,
} from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  resetHarnessConfigCache();
  await cleanupRoots(roots);
});

describe("CLI task:probe", () => {
  test("blocks a sign-off until the adversarial probe is recorded and answered", async () => {
    const { repo, run } = await setupRun("gate-order", roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");

    await expect(execute(reviewPass(run, token, gateCmd))).rejects.toThrow(
      /0 adversarial probe\(s\) recorded, 1 required/,
    );

    const probe = await recordProbe(
      run,
      token,
      "Prove an empty payload is rejected",
      "Prove the gate covers the new branch",
    );
    expect(probe.verdict).toBe("probe");
    expect(probe.probe_round).toBe(1);
    expect(probe.repair_round).toBe(0);
    expect(probe.finding_ids).toEqual(["probe-task-core-01-1", "probe-task-core-01-2"]);
    expect(String(probe.markdown)).toContain("### Adversarial Probe Recorded: task-core");
    expect(String(probe.markdown)).toContain("Demand for proof, not a defect");
    const probed = probe.task as TaskRecord;
    expect(probed.status).toBe("validating");
    expect(probed.findings!.every((finding) => finding.class === "probe_demand")).toBe(true);

    await expect(execute(reviewPass(run, token, gateCmd))).rejects.toThrow(
      /2 open finding\(s\) unanswered: probe-task-core-01-1, probe-task-core-01-2/,
    );

    const review = await execute(
      reviewPass(run, token, gateCmd, answeredBy(probe.finding_ids, gateCmd)),
    );
    expect(review.verdict).toBe("pass");
    expect(review.probe_rounds).toBe(1);
    expect(String(review.markdown)).toContain("**Adversarial Probes**: 1 answered before sign-off");
    const passed = review.task as TaskRecord;
    expect(passed.repair_round).toBe(0);
    expect(passed.findings!.every((finding) => finding.status === "resolved")).toBe(true);
  });

  test("refuses a sign-off while the recorded gate run exited non-zero", async () => {
    const { repo, run } = await setupRun("gate-red", roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const red = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--gate",
      "gate-core",
      "--actor",
      VALIDATOR,
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-red.ts",
    ]);
    expect(red.exit_code).toBe(1);

    const probe = await recordProbe(run, token, "Prove the red gate is unrelated");
    await expect(
      execute(reviewPass(run, token, gateCmd, answeredBy(probe.finding_ids, gateCmd))),
    ).rejects.toThrow(/mandatory gate evidence records a failure/);
  });

  test("a probe demand names a real requirement and cites only what it was given", async () => {
    const { repo, run } = await setupRun("probe-shape", roots);
    const token = (await claimSubmitValidate(repo, run)).token as string;
    await expect(
      execute([
        "task:probe",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--validator",
        VALIDATOR,
        "--token",
        token,
        "--demand",
        "Prove it",
        "--requirement",
        "req-invented",
      ]),
    ).rejects.toThrow(/is not owned by task-core/);

    const probe = await recordProbe(run, token, "Prove it");
    const findings = probe.findings as Record<string, unknown>[];
    expect(findings[0]!.evidence).toEqual([
      { kind: "demand", detail: "Prove it", evidence_class: "agent_reported" },
    ]);
    expect(findings[0]!.severity).toBe("minor");
  });

  test("validation start names the gate the plan recorded", async () => {
    const { repo, run } = await setupRun("gate-brief", roots);
    const started = await claimSubmitValidate(repo, run);
    expect(String(started.markdown)).toContain("bun gate-core.ts");
    expect(String(started.markdown)).not.toContain("bun test tests/unit/core");
    expect(String(started.markdown)).toContain("record 1 adversarial probe(s)");
  });

  test("a rejection escalates on the repair budget the config states", async () => {
    const { repo, run } = await setupRun("reject-budget", roots, { max_repair_rounds: 1 });
    const token = (await claimSubmitValidate(repo, run)).token as string;
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const rejected = await execute([
      "task:reject",
      "--evidence",
      gateCmd,
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      token,
      "--reason",
      "The empty payload path is unhandled",
      "--severity",
      "critical",
      "--remediation",
      "Handle the empty payload before the insert",
    ]);
    expect((rejected.task as TaskRecord).status).toBe("escalated");
    expect((rejected.task as TaskRecord).repair_round).toBe(1);
  });
});

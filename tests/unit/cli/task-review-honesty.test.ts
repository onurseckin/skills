import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gateProofCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/task-review-support.ts";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import {
  claimSubmitValidate,
  recordProbe,
  runGate,
  setupRun,
  TASK_ID,
  VALIDATOR,
} from "./probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function validating(name: string): Promise<{ repo: string; run: string; token: string }> {
  const { repo, run } = await setupRun(name, roots);
  const started = await claimSubmitValidate(repo, run);
  return { repo, run, token: started.token as string };
}

async function demandOnce(run: string, token: string, demand: string): Promise<string> {
  const probe = await recordProbe(run, token, demand);
  return (probe.finding_ids as string[])[0]!;
}

function reviewArgv(
  run: string,
  token: string,
  evidence: string,
  status: "pass" | "fail" = "pass",
): string[] {
  return [
    "task:review",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--evidence",
    evidence,
    "--status",
    status,
  ];
}

function rejectArgv(run: string, token: string, evidence: string): string[] {
  return [
    "task:reject",
    "--severity",
    "critical",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--evidence",
    evidence,
    "--reason",
    "The empty payload path is unhandled",
    "--remediation",
    "Handle the empty payload before the insert",
  ];
}

function reviewReport(run: string): { raw: string; token_digest: string; token?: string } {
  const raw = readFileSync(join(run, "reports", `${TASK_ID}-review.json`), "utf-8");
  return { raw, ...(JSON.parse(raw) as { token_digest: string; token?: string }) };
}

function reviewEventPayload(run: string): Record<string, unknown> {
  const lines = readFileSync(join(run, "events.jsonl"), "utf-8").trim().split("\n");
  const events = lines.map((line) => JSON.parse(line) as { kind: string; payload: unknown });
  const review = events.filter((event) => event.kind === "review-recorded").at(-1);
  if (!review) throw new TypeError("no review-recorded event");
  return review.payload as Record<string, unknown>;
}

describe("the review path answers nothing on the implementer's behalf", () => {
  test("a probe demand stays open until the validator names the evidence that answers it", async () => {
    const { repo, run, token } = await validating("review-answer");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const demandId = await demandOnce(run, token, "Prove the gate fails when the fix is reverted");
    const pass = reviewArgv(run, token, gateCmd);

    await expect(execute(pass)).rejects.toThrow(
      new RegExp(`1 open finding\\(s\\) unanswered: ${demandId}`),
    );
    await expect(execute([...pass, "--resolve", `probe-invented=${gateCmd}`])).rejects.toThrow(
      /task-core has no open finding probe-invented/,
    );

    const review = await execute([...pass, "--resolve", `${demandId}=${gateCmd}`]);
    expect(review.verdict).toBe("pass");
    expect(review.resolved_findings).toEqual([
      {
        finding_id: demandId,
        method: "probe_demand_answered",
        evidence: [{ command_id: gateCmd }],
      },
    ]);
    expect((review.task as TaskRecord).findings![0]!.status).toBe("resolved");
  });

  test("a rejection has nothing to answer, so --resolve is refused", async () => {
    const { repo, run, token } = await validating("review-reject-resolve");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const demandId = await demandOnce(run, token, "Prove the failure path is covered");

    await expect(
      execute([
        ...reviewArgv(run, token, gateCmd, "fail"),
        "--summary",
        "The failure path is unhandled",
        "--resolve",
        `${demandId}=${gateCmd}`,
      ]),
    ).rejects.toThrow(/--resolve applies to a passing verdict only/);
  });

  test("an unbound run of the identical command is not gate evidence", async () => {
    const { repo, run, token } = await validating("review-gate-binding");
    // Same argv, same cwd: the loose run differs from the gate run only in its binding, and the
    // binding is the whole of what makes the gate run proof of the gate.
    const looseCmd = await runGate(repo, run, "gate-core.ts", null);
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const demandId = await demandOnce(run, token, "Prove the gate output is the changed suite");
    const answer = ["--resolve", `${demandId}=${gateCmd}`];

    await expect(execute([...reviewArgv(run, token, looseCmd), ...answer])).rejects.toThrow(
      new RegExp(`${looseCmd} is not successful validator evidence`),
    );

    const review = await execute([...reviewArgv(run, token, gateCmd), ...answer]);
    const task = review.task as TaskRecord;
    expect(task.gate_results).toEqual([
      { gate_id: "gate-core", command_id: gateCmd, status: "passed" },
    ]);
    expect(task.status).toBe("done");
  });

  test("the gate result is taken from the bound command, never from an unbound one", () => {
    const commands = {
      "C-loose": { gate_id: null },
      "C-bound": { gate_id: "gate-core" },
      "C-other": { gate_id: "gate-docs" },
    };
    expect(gateProofCommand(commands, "gate-core", ["C-loose", "C-bound"])).toBe("C-bound");
    expect(gateProofCommand(commands, "gate-core", ["C-loose", "C-other"])).toBeUndefined();
    expect(gateProofCommand(commands, "gate-core", [])).toBeUndefined();
  });

  test("the review report keeps the token digest, never the token", async () => {
    const { repo, run, token } = await validating("review-token");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const demandId = await demandOnce(run, token, "Prove the assertion is not tautological");
    await execute([...reviewArgv(run, token, gateCmd), "--resolve", `${demandId}=${gateCmd}`]);

    const report = reviewReport(run);
    expect(report.raw).not.toContain(token);
    expect(report.token_digest).toBe(tokenDigest(token));
    expect(report.token).toBeUndefined();
  });

  test("a rejection report keeps the token digest, never the token", async () => {
    const { repo, run, token } = await validating("reject-token");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    await execute(rejectArgv(run, token, gateCmd));

    const report = reviewReport(run);
    expect(report.raw).not.toContain(token);
    expect(report.token_digest).toBe(tokenDigest(token));
    expect(report.token).toBeUndefined();
  });

  test("the recorded event says which verdict it was, so a clean pass never reads as a rejection", async () => {
    const { repo, run, token } = await validating("review-event");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    const demandId = await demandOnce(run, token, "Prove the suite covers the changed branch");
    await execute([...reviewArgv(run, token, gateCmd), "--resolve", `${demandId}=${gateCmd}`]);

    expect(reviewEventPayload(run)).toEqual({
      task_id: TASK_ID,
      verdict: "pass",
      round: 0,
      finding_count: 0,
      class: "probe_demand",
      resolved_count: 1,
    });
  });

  test("a rejection event carries the defect count and the round it cost", async () => {
    const { repo, run, token } = await validating("reject-event");
    const gateCmd = await runGate(repo, run, "gate-core.ts");
    await execute(rejectArgv(run, token, gateCmd));

    expect(reviewEventPayload(run)).toEqual({
      task_id: TASK_ID,
      verdict: "reject",
      round: 1,
      finding_count: 1,
      class: "defect",
    });
  });
});

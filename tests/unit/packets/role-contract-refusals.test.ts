import { describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRoleContract } from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { claimTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { beginValidation } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { submitTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { setupReadyRun } from "../cli/critic-run-fixture.ts";
import { setupRun, TASK_ID } from "../cli/probe-fixture.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TestPort,
  workflowState,
} from "../workflow/test-port.ts";
import { disposableRoots, registerGrant } from "./grant-fixture.ts";

const roots = disposableRoots();
const clock = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

describe("acting without a published contract is refused", () => {
  test("an implementer cannot submit without a published packet", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    expect(() => submitTask(port, "T-1", "implementer", token, report, clock)).toThrow(
      "implementer action requires a matching durably published packet",
    );
    registerTaskPacket(port, "implementer", "implementer", 1);
    expect(
      submitTask(port, "T-1", "implementer", token, report, clock).state.tasks["T-1"]!.status,
    ).toBe("submitted");
  });

  test("a repairer cannot submit without a published packet", () => {
    // submitTask's guard reads lease.role, not a literal "implementer" — the only way to prove it
    // actually covers repairer too is to drive a real reject-then-repair cycle and claim under that
    // role, the same path task-state uses to route rejected work back to the original implementer.
    const port = new TestPort(workflowState());
    const { token: implToken } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    registerTaskPacket(port, "implementer", "implementer", 1);
    submitTask(port, "T-1", "implementer", implToken, report, clock);
    registerCommand(port, "C-validator", "validator");
    const started = beginValidation(port, "T-1", "validator", clock);
    registerTaskPacket(
      port,
      "validator",
      "validator",
      started.tasks["T-1"]!.validations!.at(-1)!.attempt,
    );
    recordReview(
      port,
      "T-1",
      "validator",
      {
        verdict: "reject",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator" }],
        findings: [
          {
            id: "F-1",
            requirement_id: "R-1",
            severity: "important",
            observation: "missing test",
            evidence: [{ path: "a.ts" }],
            remediation: "add test",
            revalidation: "bun test",
          },
        ],
        validation_token: started.tasks["T-1"]!.validation_token,
      },
      clock,
    );
    const { token: repairToken } = claimTask(port, "T-1", "implementer", "repairer", { clock });
    expect(() => submitTask(port, "T-1", "implementer", repairToken, report, clock)).toThrow(
      "repairer action requires a matching durably published packet",
    );
    registerTaskPacket(port, "repairer", "implementer", 2);
    expect(
      submitTask(port, "T-1", "implementer", repairToken, report, clock).state.tasks["T-1"]!.status,
    ).toBe("submitted");
  });

  test("a packet published for another agent, role or attempt does not carry the submission", () => {
    for (const wrong of [
      ["implementer", "other-agent", 1],
      ["validator", "implementer", 1],
      ["implementer", "implementer", 2],
    ] as const) {
      const port = new TestPort(workflowState());
      const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
      registerTaskPacket(port, wrong[0], wrong[1], wrong[2]);
      expect(() => submitTask(port, "T-1", "implementer", token, report, clock)).toThrow(
        "requires a matching durably published packet",
      );
    }
  });

  test("a validator cannot record a verdict without a published packet", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
    registerTaskPacket(port, "implementer", "implementer", 1);
    submitTask(port, "T-1", "implementer", token, report, clock);
    registerCommand(port, "C-validator", "validator");
    const started = beginValidation(port, "T-1", "validator", clock);
    const validationToken = started.tasks["T-1"]!.validation_token;
    const review = {
      verdict: "reject",
      requirement_ids: ["R-1"],
      checks: [{ command_id: "C-validator" }],
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "important",
          observation: "missing test",
          evidence: [{ path: "a.ts" }],
          remediation: "add test",
          revalidation: "bun test",
        },
      ],
      validation_token: validationToken,
    };
    expect(() => recordReview(port, "T-1", "validator", review, clock)).toThrow(
      "validator action requires a matching durably published packet",
    );
    registerTaskPacket(
      port,
      "validator",
      "validator",
      started.tasks["T-1"]!.validations!.at(-1)!.attempt,
    );
    expect(recordReview(port, "T-1", "validator", review, clock).tasks["T-1"]!.status).toBe(
      "changes_requested",
    );
  });

  test("orphan evidence from an expired lease is still preserved", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "implementer", "implementer", {
      clock,
      leaseSeconds: 5,
    });
    const later = at("2026-08-13T12:30:00.000Z");
    const state = submitTask(port, "T-1", "implementer", token, report, later);
    expect(state.orphaned).toBe(true);
    expect(state.state.orphan_evidence).toHaveLength(1);
  });
});

describe("a granted role cannot invoke a command its contract withholds", () => {
  test("a registered validator is refused task:submit", async () => {
    const { run } = await setupRun("deny-validator", roots);
    await registerGrant(run, "val-deny", "validator");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "val-deny",
        "--token",
        "irrelevant",
        "--summary",
        "should never be recorded",
      ]),
    ).rejects.toThrow("role validator may not invoke task:submit");
  });

  test("a registered sub-investigator is refused a command that writes", async () => {
    const { run } = await setupRun("deny-investigator", roots);
    await registerGrant(run, "sub-deny", "sub-investigator");
    await expect(
      execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "sub-deny",
        "--role",
        "implementer",
      ]),
    ).rejects.toThrow("role sub-investigator may not invoke task:claim");
    expect(loadRun(run).state.tasks).toMatchObject({ [TASK_ID]: { status: "ready" } });
  });

  test("a registered implementer keeps the commands its contract grants", async () => {
    const { run } = await setupRun("allow-implementer", roots);
    await registerGrant(run, "impl-allow", "implementer");
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "impl-allow",
      "--role",
      "implementer",
    ]);
    expect(claim.role_contract_sha256).toBe(loadRoleContract("implementer").sha256);
  });

  test("the critic a grant creates is its subject, so critic:start still reaches it", async () => {
    const { run } = await setupReadyRun("subject-critic", roots);
    await registerGrant(run, "critic-1", "completeness-critic");
    const started = await execute(["critic:start", "--run", run, "--critic", "critic-1"]);
    expect(started.role_contract_sha256).toBe(loadRoleContract("completeness-critic").sha256);
  });

  test("the agent a pop leases to is its subject, so queue:pop still reaches it", async () => {
    const { run } = await setupRun("subject-pop", roots);
    await registerGrant(run, "worker-pop", "implementer");
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-pop"]);
    expect(popped.role_contract_sha256).toBe(loadRoleContract("implementer").sha256);
  });

  test("the subject exception does not leak to the rest of the critic family", async () => {
    const { run } = await setupRun("subject-leak", roots);
    await registerGrant(run, "impl-critic", "implementer");
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "impl-critic",
        "--token",
        "irrelevant",
        "--decision",
        "approve",
        "--summary",
        "should never be recorded",
      ]),
    ).rejects.toThrow("role implementer may not invoke critic:review");
  });

  test("registering a sub-agent is the coordinator's call, not the subject's", async () => {
    const { run } = await setupRun("register-subject", roots);
    await registerGrant(run, "coord-1", "coordinator");
    // --agent names the agent being created; the contract checked is the caller's.
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "new-validator",
      "--role",
      "validator",
      "--host",
      "claude-code",
      "--actor",
      "coord-1",
    ]);
    expect((loadRun(run).state.agents as { id: string }[]).map((grant) => grant.id)).toContain(
      "new-validator",
    );
  });
});

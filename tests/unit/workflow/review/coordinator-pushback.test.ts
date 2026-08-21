import { describe, expect, test } from "bun:test";
import { beginValidation } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/begin-validation.ts";
import {
  recordCoordinatorPushback,
  validateCoordinatorPushbackInput,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/coordinator-pushback.ts";
import { recordReview } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/record-review.ts";
import { claimTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { appendGateProof } from "../../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import type { GateProofRecord } from "../../../../orchestrating-long-tasks/scripts/src/graph/gate-proof.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "../test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");

const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

/** Drives a task all the way to `validated` through the real machinery: claim, submit, one
 * validator opening and passing the sole applicable domain (`workflowState()`'s default write
 * scope `["src/owned"]` draws only `code-quality`, so a single pass reaches `validated`). */
function validatedTask(): { port: TestPort; validatorId: string } {
  const port = new TestPort(workflowState());
  const { token: claimToken } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", claimToken, report, clock);

  const validatorId = "validator-a";
  registerCommand(port, `C-${validatorId}`, validatorId);
  const opened = beginValidation(port, "T-1", validatorId, clock);
  const reviewToken = opened.tasks["T-1"]!.validation_token;
  if (typeof reviewToken !== "string") throw new TypeError("validation token missing");
  registerTaskPacket(
    port,
    "validator",
    validatorId,
    opened.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );

  const proof: GateProofRecord = {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: ["src/owned"],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-13T12:00:00.000Z",
    actor: "coordinator",
  };
  port.transact("coordinator", "gate-proved", { task_id: "T-1" }, (draft) =>
    appendGateProof(draft, proof),
  );

  const passed = recordReview(
    port,
    "T-1",
    validatorId,
    {
      verdict: "pass",
      requirement_ids: ["R-1"],
      checks: [{ command_id: `C-${validatorId}` }],
      findings: [],
      validation_token: reviewToken,
    },
    clock,
  );
  expect(passed.tasks["T-1"]!.status).toBe("validated");
  return { port, validatorId };
}

const validInput = (overrides: Record<string, unknown> = {}) => ({
  validator_id: "validator-a",
  domain: "code-quality",
  cause: "procedural",
  observation: "the pass carried no recorded evidence for the code-quality domain",
  remediation: "re-open validation and record real check evidence before passing again",
  ...overrides,
});

describe("validateCoordinatorPushbackInput", () => {
  test("accepts a well-formed procedural or substantive input", () => {
    expect(validateCoordinatorPushbackInput(validInput()).cause).toBe("procedural");
    expect(validateCoordinatorPushbackInput(validInput({ cause: "substantive" })).cause).toBe(
      "substantive",
    );
  });

  test("refuses a made-up cause instead of silently defaulting", () => {
    expect(() => validateCoordinatorPushbackInput(validInput({ cause: "vibes" }))).toThrow(
      /procedural.*substantive/,
    );
  });

  test("refuses an unrecognized validator domain", () => {
    expect(() =>
      validateCoordinatorPushbackInput(validInput({ domain: "made-up-domain" })),
    ).toThrow(/recognized validator domain/);
  });

  test("requires non-blank observation and remediation", () => {
    expect(() => validateCoordinatorPushbackInput(validInput({ observation: "  " }))).toThrow();
    expect(() => validateCoordinatorPushbackInput(validInput({ remediation: "" }))).toThrow();
  });
});

describe("recordCoordinatorPushback", () => {
  test("refuses a task that is not sitting at validated", () => {
    const port = new TestPort(workflowState());
    expect(() =>
      recordCoordinatorPushback(port, "T-1", "coordinator-1", validInput(), clock),
    ).toThrow(/not validated/);
  });

  test("refuses a domain or validator that never recorded a pass on this task", () => {
    const { port } = validatedTask();
    expect(() =>
      recordCoordinatorPushback(
        port,
        "T-1",
        "coordinator-1",
        validInput({ validator_id: "someone-else" }),
        clock,
      ),
    ).toThrow(/no recorded pass/);
  });

  test("procedural: reopens validation without touching repair_round or the implementer", () => {
    const { port, validatorId } = validatedTask();
    const before = port.read().tasks["T-1"]!;
    const state = recordCoordinatorPushback(
      port,
      "T-1",
      "coordinator-1",
      validInput({ validator_id: validatorId, cause: "procedural" }),
      clock,
    );
    const task = state.tasks["T-1"]!;
    expect(task.status).toBe("validating");
    expect(task.repair_round).toBe(before.repair_round);
    expect(task.repair_assignee).toBeUndefined();
    // The disputed pass is archived, not left standing as an open validation.
    expect(task.validations ?? []).toHaveLength(0);
    expect((task.validation_history ?? []).some((v) => v.validator_id === validatorId)).toBe(true);
    const pushbacks = task.coordinator_pushbacks as { cause: string; validator_id: string }[];
    expect(pushbacks).toHaveLength(1);
    expect(pushbacks[0]!.cause).toBe("procedural");
    expect(pushbacks[0]!.validator_id).toBe(validatorId);
  });

  test("substantive: behaves like a validator reject — repair_round advances, implementer reassigned", () => {
    const { port, validatorId } = validatedTask();
    const before = port.read().tasks["T-1"]!;
    const state = recordCoordinatorPushback(
      port,
      "T-1",
      "coordinator-1",
      validInput({ validator_id: validatorId, cause: "substantive" }),
      clock,
    );
    const task = state.tasks["T-1"]!;
    expect(task.status).toBe("changes_requested");
    expect(task.repair_round).toBe(before.repair_round + 1);
    expect(task.repair_assignee).toBe("implementer");
    const pushbacks = task.coordinator_pushbacks as { cause: string }[];
    expect(pushbacks[0]!.cause).toBe("substantive");
  });

  test("substantive: escalates once repair rounds are exhausted, same as a validator reject would", () => {
    const { port, validatorId } = validatedTask();
    const state = recordCoordinatorPushback(
      port,
      "T-1",
      "coordinator-1",
      validInput({ validator_id: validatorId, cause: "substantive" }),
      clock,
      1,
    );
    expect(state.tasks["T-1"]!.status).toBe("escalated");
  });

  test("a second pushback against a fresh pass is independent of the first, and ids do not collide", () => {
    const { port, validatorId } = validatedTask();
    recordCoordinatorPushback(
      port,
      "T-1",
      "coordinator-1",
      validInput({ validator_id: validatorId, cause: "procedural" }),
      clock,
    );
    // A different, independent validator earns the re-opened domain's pass this round — the
    // first validator cannot (an existing, unrelated invariant: a validator already in this
    // task's validation_history may not validate it again).
    const secondValidator = "validator-b";
    registerCommand(port, "C-validator-b", secondValidator);
    const reopened = beginValidation(port, "T-1", secondValidator, clock);
    const token = reopened.tasks["T-1"]!.validation_token;
    if (typeof token !== "string") throw new TypeError("validation token missing");
    registerTaskPacket(
      port,
      "validator",
      secondValidator,
      reopened.tasks["T-1"]!.validations!.at(-1)!.attempt,
    );
    const passedAgain = recordReview(
      port,
      "T-1",
      secondValidator,
      {
        verdict: "pass",
        requirement_ids: ["R-1"],
        checks: [{ command_id: "C-validator-b" }],
        findings: [],
        validation_token: token,
      },
      clock,
    );
    expect(passedAgain.tasks["T-1"]!.status).toBe("validated");

    const state = recordCoordinatorPushback(
      port,
      "T-1",
      "coordinator-1",
      validInput({ validator_id: secondValidator, cause: "procedural" }),
      clock,
    );
    const pushbacks = state.tasks["T-1"]!.coordinator_pushbacks as { id: string }[];
    expect(pushbacks).toHaveLength(2);
    expect(new Set(pushbacks.map((p) => p.id)).size).toBe(2);
  });
});

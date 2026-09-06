import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { attachGateResult } from "../../../olt/scripts/src/workflow/gates/attach-result.ts";
import {
  finishTask,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "../../../olt/scripts/src/workflow/gates/finish-task.ts";
import { reviewPolicyFor } from "../../../olt/scripts/src/cli/commands/task-review-support.ts";
import { validatorProfile } from "../../../olt/scripts/src/sentinel/profiles/tier3/validator.ts";
import { setupWorkflowVirtualFs } from "../shared/index.ts";
import { at, commandRecord, TestPort, workflowState } from "../shared/test-port.ts";

const clock = at("2026-09-06T12:00:00.000Z");

function createGatedPort(overrides: Record<string, unknown> = {}): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "validated",
    report: { summary: "implementation complete" },
    validations: [
      {
        validator_id: "validator",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: clock.now().toISOString(),
        deadline_at: clock.now().toISOString(),
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-VALIDATE" }],
      },
    ],
    ...overrides,
  });
  state.commands["C-1"] = commandRecord("C-1", {
    task_id: "T-1",
    gate_id: "G-1",
  });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
  const port = new TestPort(state);
  attachGateResult(port, "T-1", "G-1", "C-1", "coordinator", clock);
  return port;
}

describe("finishTask cognitive pushback quotas enforcement", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("rejects task with 0 probes", () => {
    const port = createGatedPort();
    expect(() => finishTask(port, "T-1", "coordinator", clock)).toThrow(
      new HarnessError(
        "INVALID_STATE",
        "Cognitive deepening protocol not satisfied: task has insufficient probes/pushbacks (requires >= 5)",
      ),
    );
    expect(port.read().tasks["T-1"]!.status).toBe("gating");
  });

  test("rejects task with fewer than 5 probes (< MIN_ADVERSARIAL_PROBES)", () => {
    for (let count = 1; count < MIN_ADVERSARIAL_PROBES; count++) {
      const port1 = createGatedPort({ probe_round: count });
      expect(() => finishTask(port1, "T-1", "coordinator", clock)).toThrow(
        /Cognitive deepening protocol not satisfied: task has insufficient probes\/pushbacks/,
      );

      const port2 = createGatedPort({
        adversarial_probes: Array.from({ length: count }, (_, i) => i + 1),
      });
      expect(() => finishTask(port2, "T-1", "coordinator", clock)).toThrow(
        /Cognitive deepening protocol not satisfied: task has insufficient probes\/pushbacks/,
      );
    }
  });

  test("accepts task with exactly 5 probes (MIN_ADVERSARIAL_PROBES)", () => {
    const portByRound = createGatedPort({ probe_round: 5 });
    const done1 = finishTask(portByRound, "T-1", "coordinator", clock);
    expect(done1.tasks["T-1"]!.status).toBe("done");

    const portByArray = createGatedPort({ adversarial_probes: [1, 2, 3, 4, 5] });
    const done2 = finishTask(portByArray, "T-1", "coordinator", clock);
    expect(done2.tasks["T-1"]!.status).toBe("done");

    const portByProbes = createGatedPort({ probes: 5 });
    const done3 = finishTask(portByProbes, "T-1", "coordinator", clock);
    expect(done3.tasks["T-1"]!.status).toBe("done");
  });

  test("accepts task with more than 5 probes", () => {
    const port = createGatedPort({ probe_round: 7, adversarial_probes: [1, 2, 3, 4, 5, 6, 7] });
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
  });

  test("accepts task with 5 adversarial review history entries", () => {
    const port = createGatedPort({
      review_history: [
        { channel: "adversarial", verdict: "probe" },
        { channel: "adversarial", verdict: "probe" },
        { channel: "adversarial", verdict: "probe" },
        { channel: "adversarial", verdict: "probe" },
        { channel: "adversarial", verdict: "probe" },
      ],
    });
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
  });

  test("accepts task with bypass_quotas flag even with 0 probes", () => {
    const port = createGatedPort({ bypass_quotas: true });
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
  });

  test("accepts task with skip_quotas flag even with 0 probes", () => {
    const port = createGatedPort({ skip_quotas: true });
    const done = finishTask(port, "T-1", "coordinator", clock);
    expect(done.tasks["T-1"]!.status).toBe("done");
  });
});

describe("reviewPolicyFor pushback quotas defaulting", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "review-policy-quota-"));
    mkdirSync(join(tempDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("defaults minProbes to MIN_ADVERSARIAL_PROBES (5) when unconfigured", () => {
    const policy = reviewPolicyFor(tempDir);
    expect(policy.minProbes).toBe(MIN_ADVERSARIAL_PROBES);
    expect(policy.minProbes).toBe(5);
    expect(MANDATORY_COGNITIVE_PUSHBACKS).toBe(5);
  });

  test("honors explicitly configured min_adversarial_probes in harness config", () => {
    writeFileSync(
      join(tempDir, "harness.config.json"),
      JSON.stringify({ min_adversarial_probes: 2 }),
      "utf-8",
    );
    const policy = reviewPolicyFor(tempDir);
    expect(policy.minProbes).toBe(2);
  });
});

describe("sentinel validatorProfile insufficient pushback rounds", () => {
  test("emits VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS on probe_count < 5 and task:review action", () => {
    const violations = validatorProfile.evaluate({
      agent_id: "validator-1",
      role: "validator",
      probe_count: 3,
      action: "task:review",
    });

    const violation = violations.find((v) => v.code === "VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS");
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("CRITICAL");
    expect(violation?.message).toBe(
      "Cognitive Validator must complete at least 5 cognitive probe rounds before task finalization.",
    );
  });

  test("emits VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS on probe_count < 5 when action is omitted", () => {
    const violations = validatorProfile.evaluate({
      agent_id: "validator-1",
      role: "validator",
      probe_count: 0,
    });

    const violation = violations.find((v) => v.code === "VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS");
    expect(violation).toBeDefined();
    expect(violation?.code).toBe("VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS");
  });

  test("does not emit violation when probe_count >= 5", () => {
    const violations = validatorProfile.evaluate({
      agent_id: "validator-1",
      role: "validator",
      probe_count: 5,
      action: "task:review",
    });

    expect(violations.some((v) => v.code === "VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS")).toBe(false);
  });

  test("does not emit violation when probe_count is undefined", () => {
    const violations = validatorProfile.evaluate({
      agent_id: "validator-1",
      role: "validator",
      action: "task:review",
    });

    expect(violations.some((v) => v.code === "VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS")).toBe(false);
  });

  test("does not emit violation for non-review action when probe_count < 5", () => {
    const violations = validatorProfile.evaluate({
      agent_id: "validator-1",
      role: "validator",
      probe_count: 2,
      action: "task:claim",
    });

    expect(violations.some((v) => v.code === "VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS")).toBe(false);
  });
});

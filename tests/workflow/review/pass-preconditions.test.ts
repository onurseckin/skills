import { describe, expect, test } from "bun:test";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import {
  assertGateProofFalsifiable,
  claimedBaseSha,
  gateFalsifiabilityStatuses,
  gateRunEvidence,
} from "../../../olt/scripts/src/workflow/review/pass-preconditions.ts";
import { commandRecord, TEST_GATE_ARGV, workflowState } from "../test-port.ts";

function gateProof(overrides: Partial<GateProofRecord> = {}): GateProofRecord {
  return {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: ["src/owned"],
    base: "deadbeef",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-13T12:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}

describe("gateRunEvidence", () => {
  test("reports a gate with no recorded run at all as { gate_id } only", () => {
    const state = workflowState();
    const [entry] = gateRunEvidence(state, state.tasks["T-1"]!);
    expect(entry).toEqual({ gate_id: "G-1" });
  });

  test("reports the most recent run's status and exit code for a gate that has been run", () => {
    const state = workflowState();
    state.commands["C-1"] = commandRecord("C-1", {
      gate_id: "G-1",
      started_at: "2026-08-13T12:00:00.000Z",
    });
    const [entry] = gateRunEvidence(state, state.tasks["T-1"]!);
    expect(entry).toEqual({
      gate_id: "G-1",
      run: { gate_id: "G-1", command_id: "C-1", status: "succeeded", exit_code: 0 },
    });
  });

  test("picks the latest of several runs for the same gate by started_at", () => {
    const state = workflowState();
    state.commands["C-old"] = commandRecord("C-old", {
      gate_id: "G-1",
      started_at: "2026-08-13T11:00:00.000Z",
      finished_at: "2026-08-13T11:00:01.000Z",
    });
    state.commands["C-new"] = commandRecord("C-new", {
      gate_id: "G-1",
      started_at: "2026-08-13T13:00:00.000Z",
      finished_at: "2026-08-13T13:00:01.000Z",
    });
    const [entry] = gateRunEvidence(state, state.tasks["T-1"]!);
    expect(entry!.run?.command_id).toBe("C-new");
  });

  test("returns one entry per applicable gate", () => {
    const state = workflowState();
    state.gates.push({
      id: "G-2",
      command: ["bun", "test", "tests/unit/runner/gate-path-binding.test.ts"],
      cwd: ".",
      scope: "task",
      requirement_ids: ["R-1"],
      mandatory: true,
    });
    const entries = gateRunEvidence(state, state.tasks["T-1"]!);
    expect(entries.map((e) => e.gate_id).sort()).toEqual(["G-1", "G-2"]);
  });

  test("ignores commands recorded against a different task or a different gate", () => {
    const state = workflowState();
    state.commands["C-other-task"] = commandRecord("C-other-task", {
      gate_id: "G-1",
      task_id: "T-other",
    });
    const [entry] = gateRunEvidence(state, state.tasks["T-1"]!);
    expect(entry).toEqual({ gate_id: "G-1" });
  });
});

describe("claimedBaseSha", () => {
  test("undefined when the task has never been claimed", () => {
    const state = workflowState();
    expect(claimedBaseSha(state.tasks["T-1"]!)).toBeUndefined();
  });

  test("undefined when the current attempt recorded no base sha", () => {
    const state = workflowState();
    state.tasks["T-1"]!.attempts.push({ attempt: 1, agent_id: "a", role: "implementer" });
    expect(claimedBaseSha(state.tasks["T-1"]!)).toBeUndefined();
  });

  test("reads the sha off the most recent attempt", () => {
    const state = workflowState();
    state.tasks["T-1"]!.attempts.push(
      { attempt: 1, claimed_base_sha: evidenced("stale-sha", "harness_observed") },
      { attempt: 2, claimed_base_sha: evidenced("fresh-sha", "harness_observed") },
    );
    expect(claimedBaseSha(state.tasks["T-1"]!)).toBe("fresh-sha");
  });
});

describe("gateFalsifiabilityStatuses / assertGateProofFalsifiable", () => {
  test("no recorded proof at all: not proven, and the pass is refused", () => {
    const state = workflowState();
    const statuses = gateFalsifiabilityStatuses(state, state.tasks["T-1"]!);
    expect(statuses).toEqual([{ gate_id: "G-1", gate_argv: [...TEST_GATE_ARGV], proven: false }]);
    expect(() => assertGateProofFalsifiable(state, state.tasks["T-1"]!)).toThrow(HarnessError);
    expect(() => assertGateProofFalsifiable(state, state.tasks["T-1"]!)).toThrow(
      /no recorded falsifiable gate:prove proof for G-1/,
    );
  });

  test("a falsifiable proof matching the current write scope satisfies an unclaimed task", () => {
    const state = workflowState();
    appendGateProof(state, gateProof());
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)[0]!.proven).toBe(true);
    expect(() => assertGateProofFalsifiable(state, state.tasks["T-1"]!)).not.toThrow();
  });

  test("a not-falsifiable proof does not satisfy the precondition", () => {
    const state = workflowState();
    appendGateProof(state, gateProof({ falsifiable: false, exit_code: 0 }));
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)[0]!.proven).toBe(false);
    expect(() => assertGateProofFalsifiable(state, state.tasks["T-1"]!)).toThrow(HarnessError);
  });

  test("a proof against a narrower write scope than the task's current scope does not satisfy it", () => {
    const state = workflowState();
    appendGateProof(state, gateProof({ write_scope: ["src/owned/one-file.ts"] }));
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)[0]!.proven).toBe(false);
  });

  test("once the current attempt records a claimed base sha, a proof against a different base no longer satisfies it", () => {
    const state = workflowState();
    state.tasks["T-1"]!.attempts.push({
      attempt: 1,
      claimed_base_sha: evidenced("current-sha", "harness_observed"),
    });
    appendGateProof(state, gateProof({ base: "an-older-sha" }));
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)[0]!.proven).toBe(false);
    appendGateProof(state, gateProof({ base: "current-sha" }));
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)[0]!.proven).toBe(true);
  });

  test("a task with no mandatory task-scope gate has nothing to prove", () => {
    const state = workflowState();
    state.gates = [];
    expect(gateFalsifiabilityStatuses(state, state.tasks["T-1"]!)).toEqual([]);
    expect(() => assertGateProofFalsifiable(state, state.tasks["T-1"]!)).not.toThrow();
  });
});

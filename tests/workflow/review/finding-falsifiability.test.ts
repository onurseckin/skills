import { describe, expect, test } from "bun:test";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import { findingFalsifiabilityVerdict } from "../../../olt/scripts/src/workflow/review/finding-falsifiability.ts";
import { TEST_GATE_ARGV, workflowState } from "../test-port.ts";

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

describe("findingFalsifiabilityVerdict", () => {
  test("a task with no mandatory task-scope gate is exposed as unchecked, not silently proven", () => {
    const state = workflowState();
    state.gates = [];
    const verdict = findingFalsifiabilityVerdict(state, state.tasks["T-1"]!);
    expect(verdict).toEqual({ checked: false, proven: false, gate_ids: [], base: null });
  });

  test("a task whose gate carries a falsifiable proof against its current base is proven", () => {
    const state = workflowState();
    state.tasks["T-1"]!.attempts.push({
      attempt: 1,
      claimed_base_sha: evidenced("current-sha", "harness_observed"),
    });
    appendGateProof(state, gateProof({ base: "current-sha" }));
    const verdict = findingFalsifiabilityVerdict(state, state.tasks["T-1"]!);
    expect(verdict).toEqual({
      checked: true,
      proven: true,
      gate_ids: ["G-1"],
      base: "current-sha",
    });
  });

  test("every finding resolved in the same review shares the same round-level verdict", () => {
    const state = workflowState();
    appendGateProof(state, gateProof());
    const first = findingFalsifiabilityVerdict(state, state.tasks["T-1"]!);
    const second = findingFalsifiabilityVerdict(state, state.tasks["T-1"]!);
    expect(first).toEqual(second);
  });
});

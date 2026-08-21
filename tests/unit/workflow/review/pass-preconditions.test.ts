import { describe, expect, test } from "bun:test";
import { gateRunEvidence } from "../../../../orchestrating-long-tasks/scripts/src/workflow/review/pass-preconditions.ts";
import { commandRecord, workflowState } from "../test-port.ts";

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

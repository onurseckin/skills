import { describe, expect, test } from "bun:test";
import { attachGateResult } from "../../../olt/scripts/src/workflow/gates/attach-result.ts";
import { finalizePassingTask } from "../../../olt/scripts/src/cli/commands/task-review-support.ts";
import { at, commandRecord, TestPort, workflowState } from "../workflow/test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");

function validatedPort(): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "validated",
    report: { summary: "done" },
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
  });
  state.commands["C-1"] = commandRecord("C-1", { task_id: "T-1", gate_id: "G-1" });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
  return new TestPort(state);
}

describe("finalizePassingTask", () => {
  test("attaches every applicable gate and finishes the task", () => {
    const port = validatedPort();
    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-1"],
      port.read(),
      port,
    );
    expect(state.tasks["T-1"]!.status).toBe("done");
    expect(state.tasks["T-1"]!.gate_results).toEqual([
      { gate_id: "G-1", command_id: "C-1", status: "passed" },
    ]);
  });

  test("returns the state unchanged when the task is not in it", () => {
    const port = validatedPort();
    const before = port.read();
    const state = finalizePassingTask(
      "unused-run-root",
      "no-such-task",
      "coordinator",
      ["C-1"],
      before,
      port,
    );
    expect(state).toBe(before);
  });

  test("swallows the expected race of a gate already attached by a concurrent pass, and still finishes", () => {
    const port = validatedPort();
    attachGateResult(port, "T-1", "G-1", "C-1", "other-validator", clock);
    expect(port.read().tasks["T-1"]!.status).toBe("gating");

    port.transact("test", "second-command-recorded", {}, (draft) => {
      draft.commands["C-2"] = commandRecord("C-2", { task_id: "T-1", gate_id: "G-1" });
    });

    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-2"],
      port.read(),
      port,
    );

    expect(state.tasks["T-1"]!.status).toBe("done");
    expect(state.tasks["T-1"]!.gate_results).toEqual([
      { gate_id: "G-1", command_id: "C-1", status: "passed" },
    ]);
  });

  test("propagates a raw exception out of the gate-attach transaction instead of swallowing it", () => {
    const port = validatedPort();
    port.failNext("gate-attached");
    expect(() =>
      finalizePassingTask("unused-run-root", "T-1", "coordinator", ["C-1"], port.read(), port),
    ).toThrow("injected gate-attached failure");
  });

  test("propagates a raw exception out of the finish transaction instead of swallowing it", () => {
    const port = validatedPort();
    const stateWithNoGates = { ...port.read(), gates: [] };
    port.failNext("task-finished");
    expect(() =>
      finalizePassingTask("unused-run-root", "T-1", "coordinator", ["C-1"], stateWithNoGates, port),
    ).toThrow("injected task-finished failure");
  });

  test("propagates a HarnessError whose code is not the expected concurrent-race code", () => {
    const port = validatedPort();
    port.transact("test", "gate-removed", {}, (draft) => {
      draft.gates = [];
    });
    const staleStateStillClaimingTheGate = { ...port.read(), gates: workflowState().gates };

    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "T-1",
        "coordinator",
        ["C-1"],
        staleStateStillClaimingTheGate,
        port,
      ),
    ).toThrow("gate is not mandatory and applicable");
  });
});

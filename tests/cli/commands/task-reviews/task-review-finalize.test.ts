import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { finalizePassingTask } from "../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import type { TransactionPort, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { at, commandRecord, TestPort, workflowState } from "../../../workflow/shared/test-port.ts";

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
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE", { gate_id: null });
  return new TestPort(state);
}

class ConcurrentPostconditionPort implements TransactionPort {
  public constructor(
    private readonly delegate: TestPort,
    private readonly racingKind: "gate-attached" | "task-finished",
  ) {}

  public read(): WorkflowState {
    return this.delegate.read();
  }

  public transact(
    actor: string,
    kind: string,
    payload: JsonObject,
    mutate: (draft: WorkflowState) => void,
  ): WorkflowState {
    if (kind !== this.racingKind) return this.delegate.transact(actor, kind, payload, mutate);
    this.delegate.transact(actor, kind, payload, mutate);
    throw new HarnessError("INVALID_STATE", `concurrent ${kind}`);
  }
}

class MismatchedConcurrentGatePort implements TransactionPort {
  public constructor(private readonly delegate: TestPort) {}

  public read(): WorkflowState {
    return this.delegate.read();
  }

  public transact(
    actor: string,
    kind: string,
    payload: JsonObject,
    mutate: (draft: WorkflowState) => void,
  ): WorkflowState {
    if (kind !== "gate-attached") return this.delegate.transact(actor, kind, payload, mutate);
    this.delegate.transact(actor, "different-gate-attached", {}, (draft) => {
      const task = draft.tasks["T-1"]!;
      task.status = "gating";
      task.gate_results = [{ gate_id: "G-2", command_id: "C-1", status: "passed" }];
    });
    throw new HarnessError("INVALID_STATE", "concurrent different gate");
  }
}

describe("finalizePassingTask - Gate Attachment & State Finalization", () => {
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

  test("refuses an unknown task id", () => {
    const port = validatedPort();
    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "no-such-task",
        "coordinator",
        ["C-1"],
        port.read(),
        port,
      ),
    ).toThrow("unknown task");
  });

  test("refuses a mandatory gate with no matching proof command", () => {
    const port = validatedPort();
    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "T-1",
        "coordinator",
        ["C-VALIDATE"],
        port.read(),
        port,
      ),
    ).toThrow("no matching proof command");
    expect(port.read().tasks["T-1"]!.status).toBe("validated");
  });

  test("accepts only a durable passed result for the exact concurrent gate", () => {
    const port = validatedPort();
    const racingPort = new ConcurrentPostconditionPort(port, "gate-attached");
    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-1"],
      port.read(),
      racingPort,
    );

    expect(state.tasks["T-1"]!.status).toBe("done");
    expect(state.tasks["T-1"]!.gate_results).toEqual([
      { gate_id: "G-1", command_id: "C-1", status: "passed" },
    ]);
  });

  test("does not suppress a mismatched concurrent gate result", () => {
    const port = validatedPort();
    const racingPort = new MismatchedConcurrentGatePort(port);
    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "T-1",
        "coordinator",
        ["C-1"],
        port.read(),
        racingPort,
      ),
    ).toThrow("concurrent different gate");
  });

  test("returns the freshly reread state only after a concurrent finish is durably done", () => {
    const port = validatedPort();
    const racingPort = new ConcurrentPostconditionPort(port, "task-finished");
    const state = finalizePassingTask(
      "unused-run-root",
      "T-1",
      "coordinator",
      ["C-1"],
      port.read(),
      racingPort,
    );
    expect(state).toEqual(port.read());
    expect(state.tasks["T-1"]!.status).toBe("done");
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

  test("does not swallow a broad INVALID_STATE without a durable concurrent postcondition", () => {
    const port = validatedPort();
    const invalidStatePort: TransactionPort = {
      read: () => port.read(),
      transact: () => {
        throw new HarnessError("INVALID_STATE", "unrelated state failure");
      },
    };
    expect(() =>
      finalizePassingTask(
        "unused-run-root",
        "T-1",
        "coordinator",
        ["C-1"],
        port.read(),
        invalidStatePort,
      ),
    ).toThrow("unrelated state failure");
  });
});

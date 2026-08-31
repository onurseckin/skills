import { describe, expect, test } from "bun:test";
import { gateTally } from "../../../olt/scripts/src/workflow/completion/completion-state.ts";
import type {
  GateRuntime,
  RequirementRuntime,
  TaskRecord,
  WorkflowState,
} from "../../../olt/scripts/src/workflow/types.ts";

function requirement(id: string): RequirementRuntime {
  return {
    id,
    text: `requirement ${id}`,
    source_lines: [1],
    source_excerpt: `requirement ${id}`,
    disposition: "actionable",
    status: "satisfied",
    evidence: [],
  } as unknown as RequirementRuntime;
}

function task(id: string, requirementId: string): TaskRecord {
  return {
    id,
    label: id,
    status: "done",
    requirement_ids: [requirementId],
    write_scope: [`src/${id}`],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
  } as unknown as TaskRecord;
}

function gate(id: string, scope: "run" | "task", requirementIds: string[]): GateRuntime {
  return {
    id,
    command: ["bun", "test", id],
    cwd: ".",
    scope,
    requirement_ids: requirementIds,
    mandatory: true,
  } as unknown as GateRuntime;
}

function state(): WorkflowState {
  return {
    tasks: { "task-a": task("task-a", "req-a"), "task-b": task("task-b", "req-b") },
    requirements: [requirement("req-a"), requirement("req-b"), requirement("req-c")],
    gates: [
      gate("gate-a", "task", ["req-a"]),
      gate("gate-b", "task", ["req-b"]),
      gate("gate-run-completion", "run", []),
    ],
    commands: {},
    orphan_evidence: [],
  } as unknown as WorkflowState;
}

describe("gateTally counts gates and only gates", () => {
  test("the total is the mandatory gate set, not the requirement count", () => {
    // Three requirements, three gates: the old brief printed the requirement total as the gate
    // denominator, which happened to look plausible and measured nothing.
    expect(gateTally(state())).toEqual({ total: 3, green: 0 });
  });

  test("a gate with no authoritative passing command is not green", () => {
    const withUnprovenCommand = state();
    // An exit-zero command that no gate result points at proves nothing about the gate.
    withUnprovenCommand.commands = {
      "cmd-1": {
        id: "cmd-1",
        status: "succeeded",
        exit_code: 0,
        task_id: null,
        gate_id: null,
      },
    } as unknown as WorkflowState["commands"];
    expect(gateTally(withUnprovenCommand).green).toBe(0);
  });
});

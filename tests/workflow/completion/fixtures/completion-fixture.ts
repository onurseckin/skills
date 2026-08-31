import type { WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { commandRecord, TEST_GATE_ARGV, workflowState } from "../../shared/test-port.ts";

export function completionReadyState(): WorkflowState {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "done",
    report: { summary: "done" },
    validations: [
      {
        validator_id: "validator",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: "2026-08-13T12:00:00.000Z",
        deadline_at: "2026-08-13T13:00:00.000Z",
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-V" }],
      },
    ],
    gate_results: [{ gate_id: "G-1", command_id: "C-T", status: "passed" }],
  });
  state.requirements[0] = {
    id: "R-1",
    status: "satisfied",
    disposition: "actionable",
    evidence: ["task:T-1"],
  };
  state.gates.push({
    id: "G-RUN",
    command: TEST_GATE_ARGV,
    cwd: ".",
    scope: "run",
    requirement_ids: [],
    mandatory: true,
  });
  state.commands["C-T"] = commandRecord("C-T", { gate_id: "G-1" });
  state.commands["C-V"] = commandRecord("C-V");
  state.commands["C-RUN"] = commandRecord("C-RUN", {
    argv: TEST_GATE_ARGV,
    task_id: null,
    gate_id: "G-RUN",
    actor: "coordinator",
  });
  return state;
}

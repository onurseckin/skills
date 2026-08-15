import { describe, expect, test } from "bun:test";
import { beginCompletenessCritic } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { completionReadinessSnapshot } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/readiness-snapshot.ts";
import { recoverStale } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/recover-stale.ts";
import { at, commandRecord, TEST_GATE_ARGV, TestPort, workflowState } from "./test-port.ts";

const started = at("2026-08-13T12:00:00.000Z");
const expired = at("2026-08-13T12:21:00.000Z");

function readyPort(): TestPort {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "done",
    report: { summary: "done" },
    validation: {
      validator_id: "validator",
      token_digest: "digest",
      attempt: 1,
      started_at: started.now().toISOString(),
      deadline_at: expired.now().toISOString(),
      verdict: "pass",
      reviewed_requirement_ids: ["R-1"],
      checks: [{ command_id: "C-VALIDATE" }],
    },
    gate_results: [{ gate_id: "G-1", command_id: "C-TASK", status: "passed" }],
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
  state.commands["C-TASK"] = commandRecord("C-TASK", { gate_id: "G-1" });
  state.commands["C-VALIDATE"] = commandRecord("C-VALIDATE");
  state.commands["C-RUN"] = commandRecord("C-RUN", {
    argv: TEST_GATE_ARGV,
    task_id: null,
    gate_id: "G-RUN",
    actor: "coordinator",
  });
  return new TestPort(state);
}

describe("pre-critic readiness and durable authorization", () => {
  test("refuses authorization until every non-critic completion prerequisite is ready", () => {
    const unfinished = new TestPort(workflowState());
    expect(() => beginCompletenessCritic(unfinished, "critic", { clock: started })).toThrow(
      "not ready",
    );

    const running = readyPort();
    running.transact("test", "running-command", {}, (draft) => {
      draft.commands["C-RUNNING"] = commandRecord("C-RUNNING", {
        status: "running",
        finished_at: null,
        exit_code: null,
      });
    });
    expect(() => beginCompletenessCritic(running, "critic", { clock: started })).toThrow(
      "running command",
    );
  });

  test("binds a stable readiness digest and rejects drift", () => {
    const port = readyPort();
    const assigned = beginCompletenessCritic(port, "critic", { clock: started });
    const authorization = assigned.state.completion_critic!;
    expect(authorization.readiness_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(authorization.deadline_at).toBe("2026-08-13T12:20:00.000Z");
    expect(
      completionReadinessSnapshot(assigned.state, authorization.attempt, authorization.critic_id)
        .sha256,
    ).toBe(authorization.readiness_sha256);

    port.transact("coordinator", "requirement-drift", {}, (draft) => {
      draft.requirements[0]!.evidence.push("late:evidence");
    });
    expect(
      completionReadinessSnapshot(port.read(), authorization.attempt, authorization.critic_id)
        .sha256,
    ).not.toBe(authorization.readiness_sha256);
  });

  test("expires lost critic authority and permits only a fresh identity", () => {
    const port = readyPort();
    beginCompletenessCritic(port, "lost-critic", { clock: started });
    recoverStale(port, "coordinator", expired, { graceSeconds: 0 });
    expect(port.read().completion_critic).toMatchObject({
      critic_id: "lost-critic",
      status: "expired",
    });
    expect(() => beginCompletenessCritic(port, "lost-critic", { clock: expired })).toThrow("fresh");
    expect(
      beginCompletenessCritic(port, "fresh-critic", { clock: expired }).state.completion_critic,
    ).toMatchObject({ critic_id: "fresh-critic", attempt: 2, status: "assigned" });
  });
});

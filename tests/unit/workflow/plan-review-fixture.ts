import { at, TestPort, workflowState } from "./test-port.ts";

/** A minimal but nonempty compiled graph — `currentPlanDigest` only needs `state.graph` present. */
export function compiledPort(): TestPort {
  const state = workflowState();
  (state as unknown as { graph: unknown }).graph = {
    revision: 1,
    nodes: [{ id: "T-1", type: "task" }],
    edges: [],
  };
  return new TestPort(state);
}

/** A compiled two-task plan carrying one real dependency edge, T-2 -> T-1. */
export function compiledPortWithDependency(): TestPort {
  const port = compiledPort();
  port.transact("test", "task-added", {}, (draft) => {
    draft.tasks["T-2"] = {
      id: "T-2",
      status: "blocked",
      requirement_ids: ["R-1"],
      write_scope: ["src/owned-2"],
      dependencies: ["T-1"],
      attempts: [],
      history: [],
      repair_round: 0,
    };
    draft.gates.push({
      id: "G-2",
      command: ["bun", "test", "tests/unit/t2.test.ts"],
      cwd: ".",
      scope: "task",
      requirement_ids: ["R-1"],
      mandatory: true,
    });
  });
  return port;
}

export function registerAgent(port: TestPort, id: string, role: string): void {
  port.transact("test", "agent-registered", { agent_id: id }, (draft) => {
    const agents = (draft as unknown as { agents?: unknown[] }).agents ?? [];
    agents.push({
      id,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "test-host",
      granted_at: "2026-08-13T12:00:00.000Z",
      status: "active",
    });
    (draft as unknown as { agents: unknown[] }).agents = agents;
  });
}

export const clock = at("2026-08-13T12:00:00.000Z");

export const fourAnswers = {
  decomposition_answer: "The single task matches the single-entity prompt.",
  dependency_answer: "No dependency edges exist.",
  gate_answer: "The gate runs only this task's own scoped test file.",
  straggler_answer: "There is only one task; no wave to strand.",
  dependency_edges_reviewed: [],
  gate_ids_reviewed: ["G-1"],
};

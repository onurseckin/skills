import { describe, expect, test } from "bun:test";
import { validateRoles } from "../../../olt/scripts/src/graph/validate-roles.ts";

describe("graph validate roles", () => {
  test("flags invalid assigned_to edges and validator role mismatches", () => {
    const nodes = new Map<string, Record<string, unknown>>([
      ["task-1", { type: "task", id: "task-1" }],
      ["agent-worker", { type: "agent", id: "agent-worker", role: "implementer" }],
      ["agent-validator", { type: "agent", id: "agent-validator", role: "validator" }],
      ["artifact-1", { type: "artifact", id: "artifact-1" }],
    ]);

    // Invalid endpoint types for assigned_to
    const issues1: string[] = [];
    validateRoles(
      [{ type: "assigned_to", source: "artifact-1", target: "agent-worker" }],
      nodes,
      issues1,
    );
    expect(issues1).toContain("assigned_to edges must connect a task to an agent");

    // Validator cannot be assigned as implementer
    const issues2: string[] = [];
    validateRoles(
      [{ type: "assigned_to", source: "task-1", target: "agent-validator" }],
      nodes,
      issues2,
    );
    expect(issues2).toContain("validator agent-validator cannot implement");
  });

  test("flags invalid validates edges, non-validator agents, and duplicate role conflicts", () => {
    const nodes = new Map<string, Record<string, unknown>>([
      ["task-1", { type: "task", id: "task-1" }],
      ["agent-worker", { type: "agent", id: "agent-worker", role: "implementer" }],
      ["agent-validator", { type: "agent", id: "agent-validator", role: "validator" }],
      ["artifact-1", { type: "artifact", id: "artifact-1" }],
    ]);

    // Invalid endpoint types for validates
    const issues1: string[] = [];
    validateRoles(
      [{ type: "validates", source: "agent-validator", target: "artifact-1" }],
      nodes,
      issues1,
    );
    expect(issues1).toContain("validates edges must connect an agent to a task");

    // Non-validator agent cannot validate
    const issues2: string[] = [];
    validateRoles(
      [{ type: "validates", source: "agent-worker", target: "task-1" }],
      nodes,
      issues2,
    );
    expect(issues2).toContain("validating agent agent-worker needs validator role");

    // Same agent assigned as both implementer and validator for the same task
    const sameAgentNodes = new Map<string, Record<string, unknown>>([
      ["task-1", { type: "task", id: "task-1" }],
      ["dual-agent", { type: "agent", id: "dual-agent", role: "validator" }],
    ]);
    const issues3: string[] = [];
    validateRoles(
      [
        { type: "assigned_to", source: "task-1", target: "dual-agent" },
        { type: "validates", source: "dual-agent", target: "task-1" },
      ],
      sameAgentNodes,
      issues3,
    );
    expect(issues3).toContain("task task-1 cannot use the same implementer and validator");
  });
});

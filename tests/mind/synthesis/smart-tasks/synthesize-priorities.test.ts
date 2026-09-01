import { describe, expect, it } from "bun:test";
import {
  synthesizeTaskPriorities,
  type SmartTaskPlan,
  type TaskPrioritySynthesisOptions,
} from "../../../../olt/scripts/src/mind/tasks/smart/index.ts";

describe("synthesizeTaskPriorities unit test suite", () => {
  const createMockTask = (overrides: Partial<SmartTaskPlan> = {}): SmartTaskPlan => ({
    id: "mock-task-1",
    label: "Sample Mock Task",
    write_scope: ["src/mind/sample.ts"],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["Pass gate"],
    dependencies: [],
    source_type: "direct_prompt",
    rationale: "Default rationale",
    assigned_implementer: "impl-1",
    assigned_validator: "val-1",
    ...overrides,
  });

  it("returns empty array when given empty task list", () => {
    const result = synthesizeTaskPriorities([]);
    expect(result).toEqual([]);
  });

  it("preserves explicit valid TaskPriority assignments", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "t1", priority: "CRITICAL" }),
      createMockTask({ id: "t2", priority: "LOW" }),
      createMockTask({ id: "t3", priority: "HIGH" }),
    ];
    const result = synthesizeTaskPriorities(tasks);
    expect(result[0]?.id).toBe("t1");
    expect(result[0]?.priority).toBe("CRITICAL");
    expect(result[1]?.id).toBe("t3");
    expect(result[1]?.priority).toBe("HIGH");
    expect(result[2]?.id).toBe("t2");
    expect(result[2]?.priority).toBe("LOW");
  });

  it("maps FeedbackPriority string values to TaskPriority", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({
        id: "t1",
        priority: "CRITICAL_USER_FEEDBACK" as unknown as SmartTaskPlan["priority"],
      }),
      createMockTask({
        id: "t2",
        priority: "HIGH_ARCHITECTURAL_FEATURE" as unknown as SmartTaskPlan["priority"],
      }),
      createMockTask({
        id: "t3",
        priority: "USER_DIRECTIVE" as unknown as SmartTaskPlan["priority"],
      }),
      createMockTask({ id: "t4", priority: "NORMAL" as unknown as SmartTaskPlan["priority"] }),
    ];
    const result = synthesizeTaskPriorities(tasks);
    expect(result.find((t) => t.id === "t1")?.priority).toBe("CRITICAL");
    expect(result.find((t) => t.id === "t2")?.priority).toBe("HIGH");
    expect(result.find((t) => t.id === "t3")?.priority).toBe("HIGH");
    expect(result.find((t) => t.id === "t4")?.priority).toBe("MEDIUM");
  });

  it("infers priorities from source_type when priority is undefined", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "defect-task", source_type: "defect_remediation", priority: undefined }),
      createMockTask({ id: "feedback-task", source_type: "feedback_intake", priority: undefined }),
      createMockTask({ id: "discovery-task", source_type: "discovery", priority: undefined }),
      createMockTask({ id: "self-evo-task", source_type: "self_evolution", priority: undefined }),
    ];
    const result = synthesizeTaskPriorities(tasks);
    expect(result.find((t) => t.id === "defect-task")?.priority).toBe("CRITICAL");
    expect(result.find((t) => t.id === "feedback-task")?.priority).toBe("HIGH");
    expect(result.find((t) => t.id === "discovery-task")?.priority).toBe("MEDIUM");
    expect(result.find((t) => t.id === "self-evo-task")?.priority).toBe("MEDIUM");
  });

  it("infers priority from keyword heuristics in label and rationale", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({
        id: "sec-task",
        label: "Fix CVE security vulnerability",
        priority: undefined,
      }),
      createMockTask({ id: "perf-task", label: "Fix urgent perf regression", priority: undefined }),
      createMockTask({
        id: "doc-task",
        label: "Update minor doc cleanup chore",
        priority: undefined,
      }),
    ];
    const result = synthesizeTaskPriorities(tasks);
    expect(result.find((t) => t.id === "sec-task")?.priority).toBe("CRITICAL");
    expect(result.find((t) => t.id === "perf-task")?.priority).toBe("HIGH");
    expect(result.find((t) => t.id === "doc-task")?.priority).toBe("LOW");
  });

  it("elevates priority for tasks matching boostGoals", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "boosted-task", charter_goals: ["G_CRITICAL"], priority: "MEDIUM" }),
      createMockTask({ id: "normal-task", charter_goals: ["G_NORMAL"], priority: "MEDIUM" }),
    ];
    const options: TaskPrioritySynthesisOptions = {
      boostGoals: ["G_CRITICAL"],
    };
    const result = synthesizeTaskPriorities(tasks, options);
    expect(result.find((t) => t.id === "boosted-task")?.priority).toBe("HIGH");
    expect(result.find((t) => t.id === "normal-task")?.priority).toBe("MEDIUM");
  });

  it("propagates high priority upstream to dependency tasks", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "parent-critical", priority: "CRITICAL", dependencies: ["child-dep"] }),
      createMockTask({ id: "child-dep", priority: "LOW", dependencies: [] }),
    ];
    const result = synthesizeTaskPriorities(tasks, { propagateDependencies: true });
    const child = result.find((t) => t.id === "child-dep");
    expect(child?.priority).toBe("CRITICAL");
  });

  it("respects sortByPriority false flag to maintain input order", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "first-low", priority: "LOW" }),
      createMockTask({ id: "second-critical", priority: "CRITICAL" }),
    ];
    const result = synthesizeTaskPriorities(tasks, { sortByPriority: false });
    expect(result[0]?.id).toBe("first-low");
    expect(result[1]?.id).toBe("second-critical");
  });

  it("respects custom sourceOverrides and defaultPriority", () => {
    const tasks: readonly SmartTaskPlan[] = [
      createMockTask({ id: "custom-source", source_type: "unknown", priority: undefined }),
      createMockTask({ id: "overridden-source", source_type: "discovery", priority: undefined }),
    ];
    const result = synthesizeTaskPriorities(tasks, {
      defaultPriority: "LOW",
      sourceOverrides: { discovery: "CRITICAL" },
    });
    expect(result.find((t) => t.id === "custom-source")?.priority).toBe("LOW");
    expect(result.find((t) => t.id === "overridden-source")?.priority).toBe("CRITICAL");
  });
});

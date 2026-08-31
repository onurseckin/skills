import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PlanFixture, taskById } from "../validation/fixtures.ts";

function stateTasks(state: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return state.tasks as Record<string, Record<string, unknown>>;
}

describe("plan revision runtime and supersession", () => {
  let fixture: PlanFixture;
  beforeEach(async () => {
    fixture = new PlanFixture();
    await fixture.setup();
  });
  afterEach(async () => fixture.cleanup());

  test("preserves the complete authoritative task runtime across a valid revision", async () => {
    await fixture.apply();
    const runtime = {
      status: "changes_requested",
      attempts: [{ attempt: 2 }],
      report: { summary: "submitted" },
      validations: [{ validator_id: "agent-v", domain: "code-quality", verdict: "reject" }],
      original_implementer: "agent-i",
      repair_assignee: "agent-r",
      repair_round: 2,
      replacement_reason: "repeated_failure",
      replacement_evidence: "events/9",
      gate_results: [{ gate_id: "gate-required", command_id: "C-1", status: "passed" }],
      history: [{ status: "changes_requested" }],
    };
    fixture.store.mutateRuntime((state) => {
      Object.assign(stateTasks(state)["task-1"]!, structuredClone(runtime));
    });
    fixture.graph.revision = 2;
    await fixture.write();
    const state = await fixture.apply(1);
    expect(stateTasks(state)["task-1"]).toMatchObject(runtime);
  });

  test("planned task removal needs an explicit supersedes relation and explanation", async () => {
    for (const task of fixture.graph.nodes as Record<string, unknown>[])
      if (task.type === "task") task.requirement_ids = ["R-001", "R-002"];
    fixture.graph.edges = (fixture.graph.edges as Record<string, unknown>[]).filter(
      ({ type }) => type !== "depends_on",
    );
    taskById(fixture.graph, "task-2").status = "ready";
    await fixture.write();
    await fixture.apply();
    fixture.graph.revision = 2;
    fixture.graph.nodes = (fixture.graph.nodes as Record<string, unknown>[]).filter(
      ({ id }) => id !== "task-2" && id !== "artifact-2",
    );
    fixture.graph.edges = (fixture.graph.edges as Record<string, unknown>[]).filter(
      ({ source, target }) => source !== "task-2" && target !== "artifact-2",
    );
    await fixture.write();
    await expect(fixture.apply(1)).rejects.toThrow(/supersed/i);

    (fixture.graph.nodes as unknown[]).push({
      id: "decision-supersede-task-2",
      type: "decision",
      label: "Task 2 supersession",
      superseded_task_id: "task-2",
      explanation: "Task 1 now owns the merged obligation",
    });
    (fixture.graph.edges as unknown[]).push({
      source: "task-1",
      target: "decision-supersede-task-2",
      type: "supersedes",
    });
    await fixture.write();
    await expect(fixture.apply(1)).resolves.toBeDefined();
  });

  test("active task gate argv and cwd remain part of its frozen contract", async () => {
    await fixture.apply();
    fixture.store.mutateRuntime((state) => {
      stateTasks(state)["task-1"]!.status = "running";
    });
    fixture.graph.revision = 2;
    const gate = (fixture.graph.gates as Record<string, unknown>[]).find(
      ({ scope }) => scope === "task",
    )!;
    gate.cwd = "packages/other";
    await fixture.write();
    await expect(fixture.apply(1)).rejects.toThrow(/gate/i);
  });
});

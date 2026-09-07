import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../../../../olt/scripts/src/workflow/types.ts";
import { makeCommand, makeState, makeTask } from "../../dag/graph-fixtures.ts";

function multiRoundTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return makeTask("T-multi", {
    status: "done",
    repair_round: 1,
    original_implementer: "worker-1",
    repair_assignee: "worker-1",
    report: { summary: "Repaired the null check", files_changed: ["src/T-multi.ts"] },
    findings: [
      {
        id: "F-r1",
        requirement_id: "REQ-T-multi",
        severity: "critical",
        observation: "Null pointer in handler",
        remediation: "Add a null check",
        revalidation: "Re-run the unit gate",
        status: "resolved",
        class: "defect",
        evidence: [],
      },
    ],
    validation_history: [
      {
        validator_id: "val-r1",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "reject",
        checks: [{ command_id: "C-r1" }],
      },
    ],
    validations: [
      {
        validator_id: "val-r2",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 2,
        started_at: "2026-08-14T20:20:00.000Z",
        deadline_at: "2026-08-14T20:30:00.000Z",
        verdict: "pass",
      },
    ],
    ...overrides,
  });
}

describe("an archived round backed by validation_history stays acyclic", () => {
  test("round 1 gets its own implementer/validator pair, distinct from the live round", () => {
    const dataset = generateGraphDataset({
      runId: "run-multi-round",
      state: makeState([multiRoundTask()], {
        commands: { "C-r1": makeCommand("C-r1", { task_id: "T-multi", actor: "val-r1" }) },
      }),
    });

    const archivedImpl = dataset.nodes.find((node) => node.id === "node-task-T-multi-r1");
    expect(archivedImpl?.kind).toBe("agent");
    expect(archivedImpl?.status).toBe("warning");
    expect(archivedImpl?.metadata?.round).toBe(1);
    expect(archivedImpl?.metadata?.agentId).toBe("worker-1");

    const archivedValidator = dataset.nodes.find((node) => node.id === "node-validator-T-multi-r1");
    expect(archivedValidator?.metadata?.verdict).toBe("reject");
    expect(archivedValidator?.scripts?.map((script) => script.commandId)).toEqual(["C-r1"]);

    const live = dataset.nodes.find((node) => node.id === "node-task-T-multi");
    expect(live?.status).toBe("success");
    expect(live?.files?.map((file) => file.path)).toEqual(["src/T-multi.ts"]);
  });

  test("every edge between the two rounds points forward", () => {
    const dataset = generateGraphDataset({
      runId: "run-multi-round-edges",
      state: makeState([multiRoundTask()], {
        commands: { "C-r1": makeCommand("C-r1", { task_id: "T-multi", actor: "val-r1" }) },
      }),
    });

    const handoff = dataset.edges.find((edge) => edge.id === "edge-handoff-T-multi-r1");
    expect(handoff?.source).toBe("node-task-T-multi-r1");
    expect(handoff?.target).toBe("node-validator-T-multi-r1");

    const pushback = dataset.edges.find((edge) => edge.id === "edge-pushback-T-multi-r1");
    expect(pushback?.source).toBe("node-validator-T-multi-r1");
    expect(pushback?.target).toBe("node-task-T-multi");
    expect(pushback?.isCycle).toBeUndefined();

    const spawn = dataset.edges.find(
      (edge) => edge.kind === "spawn" && edge.target === "node-validator-T-multi-r1",
    );
    expect(spawn?.source).toBe("node-orchestrator-plan");

    const taskEdges = dataset.edges.filter(
      (edge) => edge.id.endsWith("-T-multi-r1") || edge.id.endsWith("-T-multi"),
    );
    expect(taskEdges.some((edge) => edge.isCycle === true)).toBe(false);
  });

  test("a replacement decided after an archived round backtracks from that round, not the live one", () => {
    const dataset = generateGraphDataset({
      runId: "run-multi-round-backtrack",
      state: makeState(
        [multiRoundTask({ replacement_reason: "repeated_failure", repair_assignee: "worker-2" })],
        { commands: { "C-r1": makeCommand("C-r1", { task_id: "T-multi", actor: "val-r1" }) } },
      ),
    });

    const backtrack = dataset.edges.find((edge) => edge.id === "edge-backtrack-T-multi");
    expect(backtrack?.source).toBe("node-validator-T-multi-r1");
    expect(backtrack?.target).toBe("node-task-T-multi");
    expect(backtrack?.container?.title).toBe("Reassigned (repeated_failure)");
    expect(backtrack?.container?.detail).toBe("Repair Assignee: worker-2");
    expect(dataset.edges.filter((edge) => edge.kind === "backtrack")).toHaveLength(1);
  });

  test("cascades across 3 rounds (>2 rounds) with strictly forward acyclic pushback edges", () => {
    const task = multiRoundTask({
      repair_round: 2,
      validation_history: [
        {
          validator_id: "val-r1",
          token_digest: "tok1",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
        {
          validator_id: "val-r2",
          token_digest: "tok2",
          attempt: 2,
          started_at: "2026-08-14T20:20:00.000Z",
          deadline_at: "2026-08-14T20:30:00.000Z",
          verdict: "reject",
        },
      ],
      validations: [
        {
          validator_id: "val-r3",
          domain: "code-quality",
          token_digest: "tok3",
          attempt: 3,
          started_at: "2026-08-14T20:40:00.000Z",
          deadline_at: "2026-08-14T20:50:00.000Z",
          verdict: "pass",
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-3-rounds",
      state: makeState([task]),
    });

    expect(dataset.nodes.some((n) => n.id === "node-task-T-multi-r1")).toBe(true);
    expect(dataset.nodes.some((n) => n.id === "node-validator-T-multi-r1")).toBe(true);
    expect(dataset.nodes.some((n) => n.id === "node-task-T-multi-r2")).toBe(true);
    expect(dataset.nodes.some((n) => n.id === "node-validator-T-multi-r2")).toBe(true);
    expect(dataset.nodes.some((n) => n.id === "node-task-T-multi")).toBe(true);

    const pushbackR1 = dataset.edges.find((e) => e.id === "edge-pushback-T-multi-r1");
    expect(pushbackR1?.source).toBe("node-validator-T-multi-r1");
    expect(pushbackR1?.target).toBe("node-task-T-multi-r2");

    const pushbackR2 = dataset.edges.find((e) => e.id === "edge-pushback-T-multi-r2");
    expect(pushbackR2?.source).toBe("node-validator-T-multi-r2");
    expect(pushbackR2?.target).toBe("node-task-T-multi");

    expect(dataset.edges.some((e) => e.isCycle === true)).toBe(false);
  });

  test("gracefully omits missing command records in validation history without throwing", () => {
    const task = multiRoundTask({
      validation_history: [
        {
          validator_id: "val-r1",
          token_digest: "tok",
          attempt: 1,
          verdict: "reject",
          checks: [{ command_id: "C-non-existent-dangling" }],
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-dangling-command",
      state: makeState([task], { commands: {} }),
    });

    const archivedValidator = dataset.nodes.find((n) => n.id === "node-validator-T-multi-r1");
    expect(archivedValidator).toBeDefined();
    expect(archivedValidator?.scripts ?? []).toHaveLength(0);
  });
});

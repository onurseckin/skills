import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

function twoTaskDataset() {
  const task1 = makeTask("T-1", {
    label: "Task One",
    status: "done",
    repair_round: 1,
    report: { summary: "Implemented A", files_changed: ["src/a.ts"] },
    validation: {
      validator_id: "val-1",
      token_digest: "tok",
      attempt: 1,
      started_at: "2026-08-14T20:00:00.000Z",
      deadline_at: "2026-08-14T20:10:00.000Z",
      verdict: "pass",
    },
    findings: [
      {
        id: "F-1",
        requirement_id: "REQ-T-1",
        severity: "important",
        observation: "Issue found",
        remediation: "Fixed",
        revalidation: "Check test",
        status: "resolved",
        evidence: [],
      },
    ],
  });
  const task2 = makeTask("T-2", {
    label: "Task Two",
    status: "running",
    dependencies: ["T-1"],
  });
  const gateCommand = makeCommand("C-1", {
    task_id: "T-1",
    gate_id: "gate-1",
    actor: "val-1",
  });

  return generateGraphDataset({
    runId: "test-run",
    state: makeState([task1, task2]),
    promptText: "Implement feature X",
    commands: { "C-1": gateCommand },
  });
}

describe("graph generator", () => {
  test("emits an implementer, validator and gate node per task", () => {
    const dataset = twoTaskDataset();

    expect(dataset.id).toBe("test-run");
    expect(dataset.entry).toBe("node-input-prompt");
    expect(dataset.exits).toEqual(["node-terminal-complete"]);

    const ids = dataset.nodes.map((node) => node.id);
    expect(ids).toContain("node-task-T-1");
    expect(ids).toContain("node-validator-T-1");
    expect(ids).toContain("node-gate-T-1");
    expect(ids).toContain("node-critic-authority");
    expect(ids).toContain("node-terminal-complete");

    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-1");
    expect(validator?.kind).toBe("agent");
    expect(validator?.metadata?.role).toBe("validator");
    expect(validator?.name).toBe("Validator: val-1");

    // T-2 never entered validation, so it has no validator node rather than an empty one.
    expect(ids).not.toContain("node-validator-T-2");
  });

  test("places nodes on wave-derived steps and keeps the gate beside its validator", () => {
    const dataset = twoTaskDataset();
    const step = (id: string) => dataset.nodes.find((node) => node.id === id)?.step;

    expect(step("node-input-prompt")).toBe(1);
    expect(step("node-orchestrator-plan")).toBe(1);
    expect(step("node-task-T-1")).toBe(2);
    expect(step("node-validator-T-1")).toBe(3);
    expect(step("node-gate-T-1")).toBe(3);
    expect(step("node-task-T-2")).toBe(4);
  });

  test("emits no sections when the run recorded no branches", () => {
    expect(twoTaskDataset().sections).toEqual([]);
  });

  test("routes the implementer to the gate through the validator", () => {
    const dataset = twoTaskDataset();
    const kindOf = (id: string) => dataset.edges.find((edge) => edge.id === id)?.kind;

    expect(kindOf("edge-prompt-plan")).toBe("sequence");
    expect(kindOf("edge-dispatch-T-1")).toBe("dispatch");
    expect(kindOf("edge-handoff-T-1")).toBe("handoff");
    expect(kindOf("edge-validation-T-1")).toBe("validation");
    expect(kindOf("edge-join-T-1")).toBe("join");
    expect(kindOf("edge-dep-T-1-T-2")).toBe("dependency");
    expect(kindOf("edge-critic-complete")).toBe("signoff");

    const handoff = dataset.edges.find((edge) => edge.id === "edge-handoff-T-1");
    expect(handoff?.source).toBe("node-task-T-1");
    expect(handoff?.target).toBe("node-validator-T-1");
    const validation = dataset.edges.find((edge) => edge.id === "edge-validation-T-1");
    expect(validation?.source).toBe("node-validator-T-1");
    expect(validation?.target).toBe("node-gate-T-1");
  });

  test("submits straight to the gate when no validator was ever recorded", () => {
    const dataset = twoTaskDataset();
    const gateEdge = dataset.edges.find((edge) => edge.id === "edge-gate-T-2");
    expect(gateEdge?.kind).toBe("gate");
    expect(gateEdge?.source).toBe("node-task-T-2");
    expect(gateEdge?.target).toBe("node-gate-T-2");
    expect(dataset.edges.find((edge) => edge.id === "edge-handoff-T-2")).toBeUndefined();
  });

  test("carries repair history on the implementer node instead of only a terminal status", () => {
    const dataset = twoTaskDataset();
    const implementer = dataset.nodes.find((node) => node.id === "node-task-T-1");

    expect(implementer?.status).toBe("success");
    expect(implementer?.badges).toEqual([{ label: "1 repair rounds", variant: "amber" }]);
    expect(implementer?.metadata?.repairRounds).toBe(1);
    expect(implementer?.metadata?.probeRounds).toBe(0);
  });

  test("lists only reported changes, never the write scope, as changed files", () => {
    const dataset = twoTaskDataset();
    const one = dataset.nodes.find((node) => node.id === "node-task-T-1");
    const two = dataset.nodes.find((node) => node.id === "node-task-T-2");

    // The path is the implementer's own claim, and the ref says so rather than reading as measured.
    expect(one?.files).toEqual([
      { path: "src/a.ts", mode: "write", evidence_class: "agent_reported" },
    ]);
    // T-2 filed no report, so it claims no changed files while keeping its scope in metadata.
    expect(two?.files).toEqual([]);
    expect(two?.metadata?.writeScope).toEqual(["src/T-2.ts"]);
  });

  test("keeps validator commands off the implementer node", () => {
    const dataset = twoTaskDataset();
    const implementer = dataset.nodes.find((node) => node.id === "node-task-T-1");
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-1");

    expect(implementer?.scripts).toEqual([]);
    expect(validator?.scripts?.map((script) => script.commandId)).toEqual(["C-1"]);
    expect(validator?.scripts?.[0]?.exitCode).toBe(0);
    expect(validator?.scripts?.[0]?.durationMs).toBe(1000);
    expect(validator?.scripts?.[0]?.evidence_class).toBe("harness_observed");
  });
});

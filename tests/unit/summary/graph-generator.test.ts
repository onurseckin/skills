import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { makeCommand, makeEvent, makeState, makeTask } from "./graph-fixtures.ts";

function twoTaskDataset() {
  const task1 = makeTask("T-1", {
    label: "Task One",
    status: "done",
    repair_round: 1,
    report: { summary: "Implemented A", files_changed: ["src/a.ts"] },
    validations: [
      {
        validator_id: "val-1",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "pass",
      },
    ],
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
    expect(validator?.metadata?.validatorDomain).toBe("code-quality");
    expect(validator?.name).toBe("Validator (code-quality): val-1");

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

  test("a malformed branch ledger is treated as no branches rather than throwing", () => {
    const state = {
      ...makeState([makeTask("T-1")]),
      branches: "not-an-array",
    } as unknown as ReturnType<typeof makeState>;

    const dataset = generateGraphDataset({ runId: "run-bad-branches", state });
    expect(dataset.sections).toEqual([]);
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
    // `rationale` is the report's own summary, carried onto the file it explains (B15.2); this
    // fixture builds state directly rather than through `task:submit`, so the report never states
    // `requirement_ids` and no event log exists to attribute a step, and neither field appears.
    expect(one?.files).toEqual([
      {
        path: "src/a.ts",
        mode: "write",
        evidence_class: "agent_reported",
        rationale: "Implemented A",
      },
    ]);
    // T-2 filed no report, so it claims no changed files while keeping its scope in metadata.
    expect(two?.files).toEqual([]);
    expect(two?.metadata?.writeScope).toEqual(["src/T-2.ts"]);
  });

  test("attributes a changed file to the step of the latest matching task-submitted event", () => {
    const task = makeTask("T-1", {
      status: "done",
      report: { summary: "Implemented A", files_changed: ["src/a.ts"] },
    });
    const events = [
      makeEvent("task-submitted", 3, "2026-08-14T20:00:03.000Z", "worker-1", { task_id: "T-1" }),
      // A different task's own submission never attributes a step to T-1's file.
      makeEvent("task-submitted", 5, "2026-08-14T20:00:05.000Z", "worker-2", { task_id: "T-2" }),
      // A resubmission after repair: the latest sequence for T-1 wins over the earlier one.
      makeEvent("task-submitted", 9, "2026-08-14T20:00:09.000Z", "worker-1", { task_id: "T-1" }),
    ];

    const dataset = generateGraphDataset({
      runId: "run-file-step",
      state: makeState([task]),
      events,
    });

    const file = dataset.nodes.find((node) => node.id === "node-task-T-1")?.files?.[0];
    expect(file?.step).toBe(9);
  });

  test("carries the report's own requirement ids onto a changed file, dropping any non-string entry", () => {
    const task = makeTask("T-1", {
      status: "done",
      report: {
        summary: "Implemented A",
        files_changed: ["src/a.ts"],
        requirement_ids: ["REQ-T-1", 7, "REQ-EXTRA"],
      },
    });

    const dataset = generateGraphDataset({ runId: "run-req-ids", state: makeState([task]) });
    const file = dataset.nodes.find((node) => node.id === "node-task-T-1")?.files?.[0];
    expect(file?.requirementIds).toEqual(["REQ-T-1", "REQ-EXTRA"]);
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

  // B22.3: the sub-phase commit `task:submit` recorded on the task record must reach the graph
  // node — this is the link a node in gvui uses to point at the git history it actually produced.
  test("carries a task's worktree sub-phase commit onto its implementer node", () => {
    const withCommit = makeTask("T-3", {
      status: "done",
      worktree_commit: {
        task_id: "T-3",
        worktree_id: "wt-0",
        sha: "a".repeat(40),
        subject: "chore: Task T-3",
        changed_lines: 12,
        over_limit: false,
      },
    });
    const dataset = generateGraphDataset({
      runId: "test-run",
      state: makeState([withCommit]),
      promptText: "Implement feature X",
      commands: {},
    });

    const node = dataset.nodes.find((n) => n.id === "node-task-T-3");
    expect(node?.metadata?.worktreeCommit).toEqual({
      sha: "a".repeat(40),
      subject: "chore: Task T-3",
      changedLines: 12,
      overLimit: false,
    });
  });

  test("omits worktreeCommit metadata for a task worktree isolation never touched", () => {
    const dataset = twoTaskDataset();
    const node = dataset.nodes.find((n) => n.id === "node-task-T-1");
    expect(node?.metadata?.worktreeCommit).toBeUndefined();
  });
});

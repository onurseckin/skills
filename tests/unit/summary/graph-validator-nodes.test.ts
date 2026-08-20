import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { makeState, makeTask } from "./graph-fixtures.ts";

function probedTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return makeTask("T-probe", {
    status: "validating",
    probe_round: 1,
    repair_round: 0,
    validation: {
      validator_id: "val-probe",
      token_digest: "tok",
      attempt: 1,
      started_at: "2026-08-14T20:00:00.000Z",
      deadline_at: "2026-08-14T20:10:00.000Z",
      verdict: "probe",
    },
    findings: [
      {
        id: "F-demand",
        requirement_id: "REQ-T-probe",
        severity: "important",
        observation: "Prove the parser rejects an empty payload",
        remediation: "Record a command that demonstrates the rejection",
        revalidation: "Re-run the parser gate",
        status: "open",
        class: "probe_demand",
        evidence: [],
      },
    ],
    ...overrides,
  });
}

function rejectedTask(): TaskRecord {
  return makeTask("T-defect", {
    status: "changes_requested",
    repair_round: 1,
    validation: {
      validator_id: "val-defect",
      token_digest: "tok",
      attempt: 1,
      started_at: "2026-08-14T20:00:00.000Z",
      deadline_at: "2026-08-14T20:10:00.000Z",
      verdict: "reject",
    },
    findings: [
      {
        id: "F-defect",
        requirement_id: "REQ-T-defect",
        severity: "critical",
        observation: "Null pointer in handler",
        remediation: "Add a null check",
        revalidation: "Re-run the unit gate",
        status: "open",
        class: "defect",
        evidence: [],
      },
    ],
  });
}

describe("probe and pushback are different relationships", () => {
  test("a mandatory probe emits a probe edge from the validator, not a pushback", () => {
    const dataset = generateGraphDataset({
      runId: "run-probe",
      state: makeState([probedTask()]),
    });

    const probe = dataset.edges.find((edge) => edge.id === "edge-probe-T-probe");
    expect(probe?.kind).toBe("probe");
    expect(probe?.source).toBe("node-validator-T-probe");
    expect(probe?.target).toBe("node-task-T-probe");
    expect(probe?.isCycle).toBe(true);
    expect(probe?.container?.title).toBe("Adversarial Probe (Round 1)");
    expect(probe?.container?.variant).toBe("cyan");
    expect(probe?.exchanges?.[0]?.type).toBe("probe");
    expect(probe?.exchanges?.[0]?.verdict).toBe("PROBE");
    expect(probe?.exchanges?.[0]?.finding?.class).toBe("probe_demand");

    expect(dataset.edges.some((edge) => edge.kind === "pushback")).toBe(false);
  });

  test("a genuine defect emits a pushback edge from the gate", () => {
    const dataset = generateGraphDataset({
      runId: "run-defect",
      state: makeState([rejectedTask()]),
    });

    const pushback = dataset.edges.find((edge) => edge.id === "edge-pushback-T-defect");
    expect(pushback?.kind).toBe("pushback");
    expect(pushback?.source).toBe("node-gate-T-defect");
    expect(pushback?.container?.variant).toBe("warning");
    expect(pushback?.exchanges?.[0]?.verdict).toBe("FAIL");
    expect(dataset.edges.some((edge) => edge.kind === "probe")).toBe(false);
  });

  test("a task that passed after a probe is not warning-coloured", () => {
    const passed = probedTask({
      status: "done",
      report: { summary: "Proof recorded", files_changed: ["src/T-probe.ts"] },
      validation: {
        validator_id: "val-probe",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "pass",
      },
    });
    const dataset = generateGraphDataset({ runId: "run-passed", state: makeState([passed]) });

    expect(dataset.nodes.find((node) => node.id === "node-task-T-probe")?.status).toBe("success");
    expect(dataset.nodes.find((node) => node.id === "node-gate-T-probe")?.status).toBe("success");
    expect(dataset.nodes.find((node) => node.id === "node-task-T-probe")?.badges).toEqual([
      { label: "1 adversarial probes", variant: "info" },
    ]);
  });

  test("a replaced implementer emits a backtrack edge", () => {
    const task = makeTask("T-stale", {
      status: "changes_requested",
      repair_round: 2,
      replacement_reason: "repeated_failure",
      repair_assignee: "worker-2",
    });
    const dataset = generateGraphDataset({ runId: "run-backtrack", state: makeState([task]) });

    const backtrack = dataset.edges.find((edge) => edge.kind === "backtrack");
    expect(backtrack?.id).toBe("edge-backtrack-T-stale");
    expect(backtrack?.container?.title).toBe("Reassigned (repeated_failure)");
    expect(backtrack?.container?.detail).toBe("Repairer: worker-2");
  });
});

describe("validator node", () => {
  test("owns the findings, the verdict and its own io", () => {
    const dataset = generateGraphDataset({
      runId: "run-validator",
      state: makeState([rejectedTask()]),
    });
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-defect");

    expect(validator?.metadata?.role).toBe("validator");
    expect(validator?.metadata?.findings).toHaveLength(1);
    expect(validator?.io?.inputs?.[0]?.node).toBe("node-task-T-defect");
    expect(validator?.io?.outputs?.some((port) => port.label === "Validator Findings")).toBe(true);
    expect(validator?.badge?.text).toBe("Pushback: 1 Finding");
  });

  test("announces the probe round on its badge and outputs", () => {
    const dataset = generateGraphDataset({
      runId: "run-validator-probe",
      state: makeState([probedTask()]),
    });
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-probe");

    expect(validator?.badge?.text).toBe("Adversarial Probe (Round 1)");
    expect(validator?.metadata?.probeRounds).toBe(1);
    expect(validator?.io?.outputs?.some((port) => port.label === "Adversarial Probe Demands")).toBe(
      true,
    );
  });
});

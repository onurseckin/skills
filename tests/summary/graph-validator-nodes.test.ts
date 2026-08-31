import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/types.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

function probedTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return makeTask("T-probe", {
    status: "validating",
    probe_round: 1,
    repair_round: 0,
    validations: [
      {
        validator_id: "val-probe",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "probe",
      },
    ],
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
    validations: [
      {
        validator_id: "val-defect",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "reject",
      },
    ],
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
    // Forward, not a back-edge (B25.2): the demand flows into the gate the validator's own verdict
    // already reaches, never back at the implementer it was demanded of.
    expect(probe?.target).toBe("node-gate-T-probe");
    expect(probe?.isCycle).toBeUndefined();
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
    // Sourced from the validator that rejected it, symmetric with probe (B25.2) — no
    // `validation_history` entry backs this round, so it forwards to the gate rather than to a
    // round-2 node it has no evidence for.
    expect(pushback?.source).toBe("node-validator-T-defect");
    expect(pushback?.target).toBe("node-gate-T-defect");
    expect(pushback?.isCycle).toBeUndefined();
    expect(pushback?.container?.variant).toBe("warning");
    expect(pushback?.exchanges?.[0]?.verdict).toBe("FAIL");
    expect(dataset.edges.some((edge) => edge.kind === "probe")).toBe(false);
  });

  test("a task that passed after a probe is not warning-coloured", () => {
    const passed = probedTask({
      status: "done",
      report: { summary: "Proof recorded", files_changed: ["src/T-probe.ts"] },
      validations: [
        {
          validator_id: "val-probe",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "pass",
        },
      ],
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
    expect(backtrack?.target).toBe("node-gate-T-stale");
    expect(backtrack?.isCycle).toBeUndefined();
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

  test("a validation still in flight, with no verdict recorded yet, reads as auditing", () => {
    const inFlight = makeTask("T-auditing", {
      status: "validating",
      validations: [
        {
          validator_id: "val-live",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-auditing",
      state: makeState([inFlight]),
    });
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-auditing");

    expect(validator?.badge).toEqual({ text: "Auditing", variant: "info", icon: "IconShield" });
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

/**
 * B25.2: a genuinely rejected-then-repaired task backed by a real `validation_history` entry gets
 * its own round-1 node pair, distinct from the live round's — and every edge between them points
 * forward, never back, which is the whole point of retiring the cyclic pushback edge.
 */
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

    // The live round keeps the plain, stable id — the one an external reader already knows.
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
    // Forward into the live round's own node, never back at round 1.
    expect(pushback?.target).toBe("node-task-T-multi");
    expect(pushback?.isCycle).toBeUndefined();

    const spawn = dataset.edges.find(
      (edge) => edge.kind === "spawn" && edge.target === "node-validator-T-multi-r1",
    );
    expect(spawn?.source).toBe("node-orchestrator-plan");

    // No edge in the whole dataset is still flagged as a back-edge for this task.
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
    expect(backtrack?.container?.detail).toBe("Repairer: worker-2");
    // The plain live-round backtrack path only fires when there is no archived round; here there
    // is one, so it must not also emit its own competing edge under the same id.
    expect(dataset.edges.filter((edge) => edge.kind === "backtrack")).toHaveLength(1);
  });
});

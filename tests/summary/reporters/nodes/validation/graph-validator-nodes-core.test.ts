import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../../../../olt/scripts/src/workflow/types.ts";
import { makeState, makeTask } from "../../dag/graph-fixtures.ts";

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

  test("simultaneous probe demands and defect findings emit concurrent partitioned feedback edges and ports", () => {
    const dualTask = makeTask("T-concurrent", {
      status: "changes_requested",
      probe_round: 1,
      repair_round: 1,
      validations: [
        {
          validator_id: "val-concurrent",
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
          id: "F-probe",
          requirement_id: "REQ-T-concurrent",
          severity: "important",
          observation: "Demand proof of invariant preservation",
          remediation: "Add an adversarial invariant test",
          revalidation: "Re-run test suite",
          status: "open",
          class: "probe_demand",
          evidence: [],
        },
        {
          id: "F-defect",
          requirement_id: "REQ-T-concurrent",
          severity: "critical",
          observation: "Unhandled error state on network drop",
          remediation: "Wrap call in try-catch handler",
          revalidation: "Execute disconnect simulation",
          status: "open",
          class: "defect",
          evidence: [],
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-concurrent",
      state: makeState([dualTask]),
    });

    const probeEdge = dataset.edges.find((e) => e.id === "edge-probe-T-concurrent");
    expect(probeEdge).toBeDefined();
    expect(probeEdge?.kind).toBe("probe");
    expect(probeEdge?.source).toBe("node-validator-T-concurrent");
    expect(probeEdge?.target).toBe("node-gate-T-concurrent");
    expect(probeEdge?.container?.variant).toBe("cyan");
    expect(probeEdge?.exchanges?.[0]?.verdict).toBe("PROBE");
    expect(probeEdge?.exchanges?.[0]?.finding?.class).toBe("probe_demand");
    expect(probeEdge?.exchanges?.[0]?.finding?.id).toBe("F-probe");

    const pushbackEdge = dataset.edges.find((e) => e.id === "edge-pushback-T-concurrent");
    expect(pushbackEdge).toBeDefined();
    expect(pushbackEdge?.kind).toBe("pushback");
    expect(pushbackEdge?.source).toBe("node-validator-T-concurrent");
    expect(pushbackEdge?.target).toBe("node-gate-T-concurrent");
    expect(pushbackEdge?.container?.variant).toBe("warning");
    expect(pushbackEdge?.exchanges?.[0]?.verdict).toBe("FAIL");
    expect(pushbackEdge?.exchanges?.[0]?.finding?.class).toBe("defect");
    expect(pushbackEdge?.exchanges?.[0]?.finding?.id).toBe("F-defect");

    const validator = dataset.nodes.find((n) => n.id === "node-validator-T-concurrent");
    expect(validator).toBeDefined();
    const probePort = validator?.io?.outputs?.find((p) => p.label === "Adversarial Probe Demands");
    expect(probePort).toBeDefined();
    expect(probePort?.preview).toBe("1 probe round demanding proof");

    const findingsPort = validator?.io?.outputs?.find((p) => p.label === "Validator Findings");
    expect(findingsPort).toBeDefined();
    expect(findingsPort?.preview).toBe("2 findings recorded (0 resolved)");
  });

  test("validator findings output preview strictly displays resolved vs open finding ratios", () => {
    const taskWithRatios = makeTask("T-ratios", {
      status: "changes_requested",
      repair_round: 1,
      validations: [
        {
          validator_id: "val-ratios",
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
          id: "F-1",
          requirement_id: "REQ-1",
          severity: "critical",
          observation: "Issue 1",
          remediation: "Fix 1",
          revalidation: "Check 1",
          status: "resolved",
          class: "defect",
          evidence: [],
        },
        {
          id: "F-2",
          requirement_id: "REQ-2",
          severity: "important",
          observation: "Issue 2",
          remediation: "Fix 2",
          revalidation: "Check 2",
          status: "resolved",
          class: "defect",
          evidence: [],
        },
        {
          id: "F-3",
          requirement_id: "REQ-3",
          severity: "normal",
          observation: "Issue 3",
          remediation: "Fix 3",
          revalidation: "Check 3",
          status: "resolved",
          class: "defect",
          evidence: [],
        },
        {
          id: "F-4",
          requirement_id: "REQ-4",
          severity: "critical",
          observation: "Issue 4",
          remediation: "Fix 4",
          revalidation: "Check 4",
          status: "open",
          class: "defect",
          evidence: [],
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-ratios",
      state: makeState([taskWithRatios]),
    });

    const validator = dataset.nodes.find((n) => n.id === "node-validator-T-ratios");
    expect(validator).toBeDefined();

    const findingsPort = validator?.io?.outputs?.find((p) => p.label === "Validator Findings");
    expect(findingsPort).toBeDefined();
    expect(findingsPort?.preview).toBe("4 findings recorded (3 resolved)");
  });
});

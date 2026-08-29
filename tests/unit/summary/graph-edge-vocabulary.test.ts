import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CompletionReview } from "../../../olt/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph-generator.ts";
import { makeState, makeTask } from "./graph-fixtures.ts";

const review: CompletionReview = {
  critic_id: "critic-1",
  packet_id: "p1",
  graph_revision: 1,
  readiness_sha256: "r1",
  repository_binding: {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "i1",
    git_identity_sha256: "g1",
    content_sha256: "c1",
    file_count: 1,
    total_bytes: 10,
  },
  status: "findings",
  unresolved_finding_ids: ["CF-1"],
  findings: [
    {
      id: "CF-1",
      requirement_id: "REQ-T-main",
      severity: "critical",
      observation: "Requirement is not proven end to end",
      remediation: "Record the proof",
      revalidation: "Re-run the run gate",
      evidence: [],
    },
  ],
  requirement_proofs: [],
  residual_risks: [],
  integrity_evidence: [],
  repository_command_ids: [],
  checks: [],
  reviewed_at: "2026-08-14T21:00:00.000Z",
  review_sha256: "rev",
};

const branch: BranchRecord = {
  id: "B-1",
  parent_task_id: "T-main",
  parent_agent_id: "worker-1",
  reason: "The fix needed a second pair of hands on the fixtures",
  depth: 1,
  status: "collected",
  opened_at: "2026-08-14T20:05:00.000Z",
  collected_at: "2026-08-14T20:40:00.000Z",
  sub_tasks: [
    {
      id: "B-1-fixtures",
      label: "Rebuild the fixtures",
      write_scope: ["tests/fixtures.ts"],
      status: "submitted",
      agent_id: "sub-1",
    },
  ],
};

function fullDataset() {
  const main = makeTask("T-main", {
    status: "changes_requested",
    repair_round: 2,
    probe_round: 1,
    replacement_reason: "repeated_failure",
    repair_assignee: "worker-2",
    validations: [
      {
        validator_id: "val-1",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 2,
        started_at: "2026-08-14T20:30:00.000Z",
        deadline_at: "2026-08-14T20:50:00.000Z",
        verdict: "reject",
      },
    ],
    findings: [
      {
        id: "F-defect",
        requirement_id: "REQ-T-main",
        severity: "critical",
        observation: "Handler drops the error",
        remediation: "Propagate it",
        revalidation: "Re-run the gate",
        status: "open",
        class: "defect",
        evidence: [],
      },
      {
        id: "F-demand",
        requirement_id: "REQ-T-main",
        severity: "important",
        observation: "Prove the handler rejects an empty payload",
        remediation: "Record the command",
        revalidation: "Re-run the gate",
        status: "open",
        class: "probe_demand",
        probe_round: 1,
        evidence: [],
      },
    ],
  });
  const downstream = makeTask("T-downstream", { status: "ready", dependencies: ["T-main"] });

  return generateGraphDataset({
    runId: "run-vocabulary",
    state: makeState([main, downstream], {
      branches: [branch],
      completion_review: review,
    }),
    promptText: "Exercise the whole relationship vocabulary",
  });
}

describe("edge vocabulary", () => {
  test("emits every declared relationship kind when the run contains one", () => {
    const kinds = new Set(fullDataset().edges.map((edge) => edge.kind));
    expect([...kinds].sort()).toEqual([
      "backtrack",
      "branch",
      "collect",
      "critic",
      "dependency",
      "dispatch",
      "gate",
      "handoff",
      "join",
      "probe",
      "pushback",
      "sequence",
      "signoff",
      "spawn",
      "validation",
    ]);
  });

  test("spawns the validator from the plan rather than from the implementer", () => {
    const spawn = fullDataset().edges.find((edge) => edge.kind === "spawn");
    expect(spawn?.source).toBe("node-orchestrator-plan");
    expect(spawn?.target).toBe("node-validator-T-main");
  });

  test("points critic findings back at the gate of the task that owns the requirement", () => {
    const critic = fullDataset().edges.find((edge) => edge.kind === "critic");
    expect(critic?.source).toBe("node-critic-authority");
    expect(critic?.target).toBe("node-gate-T-main");
    expect(critic?.container?.title).toBe("Critic Finding (1)");
  });

  test("reports no gate verdict while the gate has not decided", () => {
    const dataset = fullDataset();
    const pending = dataset.edges.find((edge) => edge.id === "edge-join-T-downstream");
    expect(pending?.kind).toBe("join");
    expect(pending?.exchanges?.[0]?.verdict).toBeUndefined();

    const passed = generateGraphDataset({
      runId: "run-passed",
      state: makeState([makeTask("T-ok", { status: "done" })]),
    }).edges.find((edge) => edge.id === "edge-join-T-ok");
    expect(passed?.exchanges?.[0]?.verdict).toBe("PASS");
  });

  test("gives every edge a source and target that exist as nodes", () => {
    const dataset = fullDataset();
    const ids = new Set(dataset.nodes.map((node) => node.id));
    for (const edge of dataset.edges) {
      expect(`${edge.id}:${ids.has(edge.source)}:${ids.has(edge.target)}`).toBe(
        `${edge.id}:true:true`,
      );
    }
  });
});

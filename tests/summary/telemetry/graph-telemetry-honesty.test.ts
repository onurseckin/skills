import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { makeGrant, makeState, makeTask } from "../reporters/dag/graph-fixtures.ts";

function leasedTask(agentId: string): TaskRecord {
  return makeTask("T-1", {
    status: "done",
    report: { summary: "done", files_changed: ["src/T-1.ts"] },
    lease: {
      agent_id: agentId,
      role: "implementer",
      attempt: 1,
      token_digest: "tok",
      issued_at: "2026-08-14T20:00:00.000Z",
      expires_at: "2026-08-14T21:00:00.000Z",
      heartbeat_at: "2026-08-14T20:00:00.000Z",
      duration_seconds: 3600,
      write_scope: ["src/T-1.ts"],
      resource_scope: [],
    },
  });
}

describe("per-agent telemetry comes only from the grant ledger", () => {
  test("an agent with no grant gets no model, tier or thinking level", () => {
    const dataset = generateGraphDataset({
      runId: "run-no-ledger",
      state: makeState([leasedTask("worker-1")]),
    });
    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-1");

    expect(node?.telemetry).toBeUndefined();
    const serialized = JSON.stringify(dataset);
    expect(serialized).not.toContain('"model"');
    expect(serialized).not.toContain('"modelName"');
    expect(serialized).not.toContain('"tier"');
  });

  test("a grant's reported model reaches the node with its evidence class intact", () => {
    const grants = [
      makeGrant("worker-1", {
        model: { value: "claude-opus-4", evidence_class: "host_reported" },
        thinking_level: { value: "high", evidence_class: "host_reported" },
      }),
      makeGrant("val-1", { role: "validator", host: "antigravity" }),
    ];
    const task = {
      ...leasedTask("worker-1"),
      validations: [
        {
          validator_id: "val-1",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:10:00.000Z",
          deadline_at: "2026-08-14T20:20:00.000Z",
          verdict: "pass" as const,
        },
      ],
    };
    const dataset = generateGraphDataset({
      runId: "run-ledger",
      state: makeState([task], { agents: grants }),
    });

    const implementer = dataset.nodes.find((entry) => entry.id === "node-task-T-1");
    expect(implementer?.telemetry?.model).toEqual({
      value: "claude-opus-4",
      evidence_class: "host_reported",
    });
    expect(implementer?.telemetry?.modelTier).toBeUndefined();
    expect(implementer?.telemetry?.thinkingLevel?.value).toBe("high");

    const validator = dataset.nodes.find((entry) => entry.id === "node-validator-T-1");
    expect(validator?.telemetry?.agentId).toBe("val-1");
    expect(validator?.telemetry?.model).toBeUndefined();
    expect(validator?.telemetry?.modelTier).toBeUndefined();
  });

  test("host-reported token counts are used verbatim and estimates stay flagged", () => {
    const grants = [
      makeGrant("worker-1", {
        tokens_in: { value: 1234, evidence_class: "host_reported" },
        tokens_out: { value: 567, evidence_class: "host_reported" },
      }),
    ];
    const reported = generateGraphDataset({
      runId: "run-tokens",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    }).nodes.find((entry) => entry.id === "node-task-T-1");

    expect(reported?.metrics?.tokens).toMatchObject({
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
      isEstimated: false,
      evidenceClass: "host_reported",
    });

    const estimated = generateGraphDataset({
      runId: "run-estimate",
      state: makeState([leasedTask("worker-1")]),
    }).nodes.find((entry) => entry.id === "node-task-T-1");

    expect(estimated?.metrics?.tokens?.isEstimated).toBe(true);
    expect(estimated?.metrics?.tokens?.evidenceClass).toBe("derived");
  });

  test("a model name never becomes a tier, however large the model sounds", () => {
    const grants = [
      makeGrant("worker-1", {
        model: { value: "claude-3-opus-20240229", evidence_class: "host_reported" },
      }),
    ];
    const dataset = generateGraphDataset({
      runId: "run-untiered",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    });

    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-1");
    expect(node?.telemetry?.model?.value).toBe("claude-3-opus-20240229");
    expect(node?.telemetry?.modelTier).toBeUndefined();
    expect(JSON.stringify(dataset)).not.toContain('"modelTier"');
  });

  test("a host-reported tier reaches the node with its evidence class intact", () => {
    const grants = [
      makeGrant("worker-1", {
        model: { value: "some-model", evidence_class: "host_reported" },
        model_tier: { value: "s", evidence_class: "host_reported" },
      }),
    ];
    const dataset = generateGraphDataset({
      runId: "run-tiered",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    });

    expect(
      dataset.nodes.find((entry) => entry.id === "node-task-T-1")?.telemetry?.modelTier,
    ).toEqual({ value: "s", evidence_class: "host_reported" });
  });

  test("a malformed ledger is reported on the plan node instead of silently emptied", () => {
    const dataset = generateGraphDataset({
      runId: "run-broken-ledger",
      state: makeState([leasedTask("worker-1")], {
        agents: [{ id: "worker-1" }] as unknown as WorkflowState["agents"],
      }),
    });
    const plan = dataset.nodes.find((entry) => entry.id === "node-orchestrator-plan");

    expect(String(plan?.metadata?.agentLedgerIssue)).toContain("state.agents[0]");
    expect(dataset.nodes.find((entry) => entry.id === "node-task-T-1")?.telemetry).toBeUndefined();
  });

  test("records which harness exported the capsule without attributing it to an agent", () => {
    const dataset = generateGraphDataset({
      runId: "run-host",
      state: makeState([leasedTask("worker-1")]),
    });
    const identity = dataset.nodes.find((entry) => entry.id === "node-orchestrator-plan")?.metadata
      ?.hostIdentity;

    if (identity !== undefined) {
      expect(Object.keys(identity as Record<string, unknown>).sort()).toEqual([
        "evidenceClass",
        "hostTool",
      ]);
    }
  });
});

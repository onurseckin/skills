import { describe, expect, test } from "bun:test";
import type { CompletionReview, TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { collectTimeline } from "../../../../olt/scripts/src/summary/metrics/index.ts";
import { assetUrlCounts, makeEvent, makeState, makeTask } from "../dag/graph-fixtures.ts";

const visualTask: TaskRecord = makeTask("T-full-visual", {
  label: "Full Visual Pipeline Task",
  status: "changes_requested",
  requirement_ids: ["REQ-EXP-01"],
  write_scope: ["src/components/Chart.tsx"],
  repair_round: 1,
  report: {
    summary: "Chart rendering implemented",
    files_changed: ["src/components/Chart.tsx"],
    screenshots: ["test-results/chart-render.png"],
  },
  validations: [
    {
      validator_id: "val-chart-spec",
      domain: "code-quality",
      token_digest: "tok",
      attempt: 1,
      started_at: "2026-08-15T19:20:00.000Z",
      deadline_at: "2026-08-15T19:40:00.000Z",
      verdict: "reject",
      screenshots: ["evidence/chart-overflow.png"],
    },
  ],
  findings: [
    {
      id: "F-CHART-01",
      requirement_id: "REQ-EXP-01",
      severity: "critical",
      observation: "X-axis labels clip on narrow displays",
      remediation: "Wrap the labels",
      revalidation: "Re-run the chart gate",
      screenshots: ["evidence/chart-clip-mobile.png"],
      status: "open",
      evidence: [],
    },
  ],
});

const completionReview: CompletionReview = {
  critic_id: "critic-lead-auditor",
  packet_id: "packet-1",
  packet_sha256: "sha-1",
  graph_revision: 1,
  readiness_sha256: "ready-1",
  repository_binding: {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "i1",
    git_identity_sha256: "g1",
    content_sha256: "c1",
    file_count: 1,
    total_bytes: 500,
  },
  status: "findings",
  unresolved_finding_ids: ["CRITIC-FINDING-VISUAL"],
  findings: [
    {
      id: "CRITIC-FINDING-VISUAL",
      requirement_id: "REQ-EXP-01",
      severity: "critical",
      observation: "Visual baseline mismatch in summary report",
      remediation: "Refresh the baseline",
      revalidation: "Re-run the visual gate",
      screenshots: ["evidence/critic-baseline-diff.png"],
      evidence: [],
    },
  ],
  integrity_evidence: [{ kind: "screenshot", path: "evidence/critic-seal.png" }],
  requirement_proofs: [],
  residual_risks: [],
  repository_command_ids: [],
  checks: [],
  reviewed_at: "2026-08-15T19:25:00.000Z",
  review_sha256: "rev-sha",
};

function visualDataset() {
  return generateGraphDataset({
    runId: "run-visual-dataset-test",
    state: makeState([visualTask], { completion_review: completionReview }),
    promptText: "Implement visual chart with verification",
  });
}

function drawnGraph(dataset: { nodes: unknown; edges: unknown; sections?: unknown }): string {
  return JSON.stringify({
    nodes: dataset.nodes,
    edges: dataset.edges,
    sections: dataset.sections,
  });
}

describe("per-node evidence ownership", () => {
  test("gives each asset exactly one owner across the whole dataset", () => {
    const counts = assetUrlCounts(visualDataset());
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect([...counts.keys()].sort()).toEqual([
      "evidence/chart-clip-mobile.png",
      "evidence/chart-overflow.png",
      "evidence/critic-baseline-diff.png",
      "evidence/critic-seal.png",
      "test-results/chart-render.png",
    ]);
  });

  test("splits implementer evidence from validator evidence", () => {
    const dataset = visualDataset();
    const urls = (id: string) =>
      dataset.nodes.find((node) => node.id === id)?.assets?.map((asset) => asset.url) ?? [];

    expect(urls("node-task-T-full-visual")).toEqual(["test-results/chart-render.png"]);
    expect(urls("node-validator-T-full-visual").sort()).toEqual([
      "evidence/chart-clip-mobile.png",
      "evidence/chart-overflow.png",
    ]);
    expect(urls("node-gate-T-full-visual")).toEqual([]);
    expect(urls("node-critic-authority").sort()).toEqual([
      "evidence/critic-baseline-diff.png",
      "evidence/critic-seal.png",
    ]);
  });

  test("carries no legacy duplicate asset fields anywhere in the drawn graph", () => {
    const serialized = drawnGraph(visualDataset());
    expect(serialized).not.toContain('"mediaAssets"');
    expect(serialized).not.toContain('"screenshots"');
    expect(serialized).not.toContain('"playwrightMetadata"');
  });

  test("findings reference their evidence by asset id instead of copying it", () => {
    const dataset = visualDataset();
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-full-visual");
    const finding = validator?.metadata?.findings?.[0];

    expect(finding?.id).toBe("F-CHART-01");
    expect(finding?.screenshots).toBeUndefined();
    expect(finding?.screenshotAssetIds).toHaveLength(1);
    const assetId = finding?.screenshotAssetIds?.[0];
    expect(validator?.assets?.some((asset) => asset.id === assetId)).toBe(true);
  });

  test("does not repeat the same url in a JSON scan of the drawn graph", () => {
    const serialized = drawnGraph(visualDataset());
    const occurrences = serialized.split("evidence/chart-clip-mobile.png").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("critic finding ownership", () => {
  test("leaves a validator's review findings on the gate instead of republishing them", () => {
    const rejected = makeTask("T-events", {
      status: "changes_requested",
      repair_round: 1,
      findings: [
        {
          id: "finding-T-events-1",
          requirement_id: "REQ-T-events",
          severity: "important",
          observation: "The decoder never checks the buffer bound",
          remediation: "Check the bound before the read",
          revalidation: "Run gate tests for T-events",
          status: "open",
        },
      ],
    });
    const events = [
      makeEvent("review-recorded", 1, "2026-08-15T19:05:00.000Z", "val-events", {
        task_id: "T-events",
        verdict: "reject",
        round: 1,
        finding_count: 1,
      }),
    ];
    const dataset = generateGraphDataset({
      runId: "run-critic-scope",
      state: makeState([rejected]),
      promptText: "scope the critic",
      events,
    });

    const owners = new Map<string, string[]>();
    for (const node of dataset.nodes) {
      for (const finding of node.metadata?.findings ?? []) {
        owners.set(finding.id, [...(owners.get(finding.id) ?? []), node.id]);
      }
    }
    expect([...owners].map(([id, nodes]) => `${id}:${nodes.join(",")}`)).toEqual([
      "finding-T-events-1:node-gate-T-events",
    ]);
    expect(
      dataset.nodes.find((node) => node.id === "node-critic-authority")?.metadata?.findings,
    ).toEqual([]);
  });
});

describe("timeline telemetry", () => {
  test("propagates pushback reason, findings, validator and severity", () => {
    const events = [
      makeEvent("task-validation-started", 1, "2026-08-15T19:00:00.000Z", "validator-bob", {
        task_id: "T-10",
        validator_id: "validator-bob",
      }),
      makeEvent("review-recorded", 2, "2026-08-15T19:05:00.000Z", "validator-bob", {
        task_id: "T-10",
        verdict: "reject",
        round: 1,
        pushback_reason: "Failed contract invariant in schema validation",
        findings: 2,
        severity: "critical",
        validator_id: "validator-bob",
        duration_ms: 5000,
        tokens: 450,
      }),
    ];

    const timeline = collectTimeline(events, 1024);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].pushback_reason).toBe("Failed contract invariant in schema validation");
    expect(timeline[1].findings).toBe(2);
    expect(timeline[1].round).toBe(1);
    expect(timeline[1].validator_id).toBe("validator-bob");
  });
});

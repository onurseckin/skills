import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type {
  CompletionReview,
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { collectTimeline } from "../../../orchestrating-long-tasks/scripts/src/summary/timeline-collector.ts";

describe("Round 3: Graph Export & Timeline Telemetry", () => {
  test("generateGraphDataset populates visual assets and finding screenshots across task, gate, critic, and terminal nodes", () => {
    const task: TaskRecord = {
      id: "T-full-visual",
      label: "Full Visual Pipeline Task",
      status: "changes_requested",
      requirement_ids: ["REQ-EXP-01"],
      write_scope: ["src/components/Chart.tsx"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      report: {
        summary: "Chart rendering implemented",
        files_changed: ["src/components/Chart.tsx"],
        screenshots: ["test-results/chart-render.png"],
      },
      validation: {
        validator_id: "val-chart-spec",
        verdict: "reject",
        screenshots: ["evidence/chart-overflow.png"],
      },
      findings: [
        {
          id: "F-CHART-01",
          requirement_id: "REQ-EXP-01",
          severity: "critical",
          observation: "X-axis labels clip on narrow displays",
          pushback_reason: "X-axis labels clip on narrow displays",
          screenshots: ["evidence/chart-clip-mobile.png"],
          status: "open",
        },
      ],
    };

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
          screenshots: ["evidence/critic-baseline-diff.png"],
        },
      ],
      integrity_evidence: [
        {
          kind: "screenshot",
          path: "evidence/critic-seal.png",
        },
      ],
      requirement_proofs: [],
      residual_risks: [],
      repository_command_ids: [],
      checks: [],
      reviewed_at: "2026-08-15T19:25:00.000Z",
      review_sha256: "rev-sha",
    };

    const state: WorkflowState = {
      tasks: { "T-full-visual": task },
      requirements: [],
      gates: [],
      commands: {},
      orphan_evidence: [],
      graph_revision: 1,
      completion_review: completionReview,
      completion_result: {
        status: "complete",
        actor: "coord",
        completed_at: "2026-08-15T19:30:00.000Z",
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
        critic_review_sha256: "rev-sha",
        artifact_verification_sha256: "art-sha",
        mandatory_run_gate_commands: [],
      },
    };

    const dataset = generateGraphDataset({
      runId: "run-visual-dataset-test",
      state,
      promptText: "Implement visual chart with verification",
    });

    const taskNode = dataset.nodes.find((n) => n.id === "node-task-T-full-visual");
    expect(taskNode).toBeDefined();
    expect(taskNode?.mediaAssets?.length).toBeGreaterThanOrEqual(3);
    expect(taskNode?.screenshots?.length).toBeGreaterThanOrEqual(3);
    expect(taskNode?.metadata?.mediaAssets?.length).toBeGreaterThanOrEqual(3);
    expect(taskNode?.metadata?.screenshots?.length).toBeGreaterThanOrEqual(3);
    expect(taskNode?.metadata?.assets?.length).toBeGreaterThanOrEqual(3);

    const taskFinding = taskNode?.metadata?.findings?.[0];
    expect(taskFinding).toBeDefined();
    expect(taskFinding?.screenshots).toHaveLength(1);
    expect(taskFinding?.screenshots?.[0]?.url).toBe("evidence/chart-clip-mobile.png");
    expect(taskFinding?.screenshots?.[0]?.dimensions).toEqual({ width: 1280, height: 720 });
    expect(taskFinding?.screenshots?.[0]?.mimeType).toBe("image/png");
    expect(taskFinding?.screenshots?.[0]?.author).toBe("val-chart-spec");

    const gateNode = dataset.nodes.find((n) => n.id === "node-gate-T-full-visual");
    expect(gateNode).toBeDefined();
    expect(gateNode?.mediaAssets?.length).toBeGreaterThanOrEqual(3);
    expect(gateNode?.screenshots?.length).toBeGreaterThanOrEqual(3);
    expect(gateNode?.metadata?.mediaAssets?.length).toBeGreaterThanOrEqual(3);
    expect(gateNode?.metadata?.screenshots?.length).toBeGreaterThanOrEqual(3);
    expect(gateNode?.metadata?.assets?.length).toBeGreaterThanOrEqual(3);

    const gateFinding = gateNode?.metadata?.findings?.[0];
    expect(gateFinding).toBeDefined();
    expect(gateFinding?.screenshots?.[0]?.url).toBe("evidence/chart-clip-mobile.png");

    const criticNode = dataset.nodes.find((n) => n.id === "node-critic-authority");
    expect(criticNode).toBeDefined();
    expect(criticNode?.mediaAssets?.length).toBeGreaterThanOrEqual(2);
    expect(criticNode?.screenshots?.length).toBeGreaterThanOrEqual(2);
    expect(criticNode?.metadata?.mediaAssets?.length).toBeGreaterThanOrEqual(2);
    expect(criticNode?.metadata?.screenshots?.length).toBeGreaterThanOrEqual(2);
    expect(criticNode?.metadata?.assets?.length).toBeGreaterThanOrEqual(2);

    const criticFinding = criticNode?.metadata?.findings?.[0];
    expect(criticFinding).toBeDefined();
    expect(criticFinding?.screenshots?.[0]?.url).toBe("evidence/critic-baseline-diff.png");
    expect(criticFinding?.screenshots?.[0]?.dimensions).toEqual({ width: 1280, height: 720 });
    expect(criticFinding?.screenshots?.[0]?.author).toBe("critic-lead-auditor");

    const terminalNode = dataset.nodes.find((n) => n.id === "node-terminal-complete");
    expect(terminalNode).toBeDefined();
    expect(terminalNode?.mediaAssets).toBeDefined();
    expect(terminalNode?.screenshots).toBeDefined();
    expect(terminalNode?.metadata?.mediaAssets).toBeDefined();
    expect(terminalNode?.metadata?.screenshots).toBeDefined();
    expect(terminalNode?.metadata?.assets).toBeDefined();
  });

  test("collects timeline events and propagates pushback_reason, findings, validator_id, severity", () => {
    const events: HarnessEvent[] = [
      {
        schema: "harness.event",
        version: 1,
        kind: "task-validation-started",
        sequence: 1,
        timestamp: "2026-08-15T19:00:00.000Z",
        actor: "validator-bob",
        payload: {
          task_id: "T-10",
          validator_id: "validator-bob",
        },
      },
      {
        schema: "harness.event",
        version: 1,
        kind: "review-recorded",
        sequence: 2,
        timestamp: "2026-08-15T19:05:00.000Z",
        actor: "validator-bob",
        payload: {
          task_id: "T-10",
          verdict: "reject",
          round: 1,
          pushback_reason: "Failed contract invariant in schema validation",
          findings: 2,
          severity: "critical",
          validator_id: "validator-bob",
          duration_ms: 5000,
          tokens: 450,
        },
      },
      {
        schema: "harness.event",
        version: 1,
        kind: "critic-reviewed",
        sequence: 3,
        timestamp: "2026-08-15T19:15:00.000Z",
        actor: "critic-lead",
        payload: {
          verdict: "pass",
          critic_id: "critic-lead",
          findings: 0,
          tokens: 800,
        },
      },
    ];

    const timeline = collectTimeline(events, 1024);
    expect(timeline).toHaveLength(3);

    const valEvent = timeline[0];
    expect(valEvent.validator_id).toBe("validator-bob");

    const reviewEvent = timeline[1];
    expect(reviewEvent.phase).toBe("repair");
    expect(reviewEvent.pushback_reason).toBe("Failed contract invariant in schema validation");
    expect(reviewEvent.findings).toBe(2);
    expect(reviewEvent.severity).toBe("critical");
    expect(reviewEvent.round).toBe(1);
    expect(reviewEvent.duration_ms).toBe(5000);
    expect(reviewEvent.tokens).toBe(450);
    expect(reviewEvent.validator_id).toBe("validator-bob");

    const criticEvent = timeline[2];
    expect(criticEvent.phase).toBe("review");
    expect(criticEvent.validator_id).toBe("critic-lead");
    expect(criticEvent.findings).toBe(0);
  });
});

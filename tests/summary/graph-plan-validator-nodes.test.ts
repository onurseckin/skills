import { describe, expect, test } from "bun:test";
import {
  buildPlanValidatorNodes,
  generateGraphDataset,
} from "../../../olt/scripts/src/summary/graph/index.ts";
import type {
  PlanReview,
  PlanValidationAuthorization,
  WorkflowState,
} from "../../../olt/scripts/src/workflow/types.ts";
import { makeState, makeTask } from "./graph-fixtures.ts";

function round(overrides: Partial<PlanValidationAuthorization> = {}): PlanValidationAuthorization {
  return {
    validator_id: "plan-val-1",
    token_digest: "digest",
    attempt: 1,
    status: "reviewed",
    started_at: "2026-08-19T12:00:00.000Z",
    deadline_at: "2026-08-19T12:20:00.000Z",
    graph_revision: 1,
    plan_digest: "digest-1",
    ...overrides,
  };
}

function review(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    validator_id: "plan-val-1",
    packet_id: "direct",
    graph_revision: 1,
    plan_digest: "digest-1",
    summary: "Sound.",
    status: "approved",
    decomposition_answer: "a",
    dependency_answer: "b",
    gate_answer: "c",
    straggler_answer: "d",
    findings: [],
    dependency_edges_reviewed: [],
    gate_ids_reviewed: [],
    checks: [],
    reviewed_at: "2026-08-19T12:05:00.000Z",
    review_sha256: "sha",
    ...overrides,
  };
}

describe("buildPlanValidatorNodes", () => {
  test("renders nothing for a run that never dispatched a plan-validator", () => {
    const state = makeState([makeTask("T-1")]) as WorkflowState;
    const result = buildPlanValidatorNodes({ state });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("an approved round signs off onto the plan node", () => {
    const state = makeState([makeTask("T-1")], {
      plan_validation_history: [round()],
      plan_reviews: [review()],
    }) as WorkflowState;
    const result = buildPlanValidatorNodes({ state });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("node-plan-validator-r1");
    const signoff = result.edges.find((edge) => edge.kind === "signoff");
    expect(signoff?.source).toBe("node-plan-validator-r1");
    expect(signoff?.target).toBe("node-orchestrator-plan");
  });

  test("a rejected round with no later round pushes back onto the plan node", () => {
    const state = makeState([makeTask("T-1")], {
      plan_validation_history: [round()],
      plan_reviews: [
        review({
          status: "changes_requested",
          findings: [
            {
              id: "PV-1",
              severity: "critical",
              observation: "Compressed.",
              remediation: "Split it.",
            },
          ],
        }),
      ],
    }) as WorkflowState;
    const result = buildPlanValidatorNodes({ state });
    const pushback = result.edges.find((edge) => edge.kind === "pushback");
    expect(pushback).toBeDefined();
    expect(pushback?.source).toBe("node-plan-validator-r1");
    expect(pushback?.target).toBe("node-orchestrator-plan");
    expect(pushback?.exchanges?.[0]?.verdict).toBe("FAIL");
  });

  test("a rejected round followed by a fresh round pushes forward onto that round's node — never a cycle back to round 1", () => {
    const state = makeState([makeTask("T-1")], {
      plan_validation_history: [
        round({ graph_revision: 1, plan_digest: "digest-1" }),
        round({ validator_id: "plan-val-2", graph_revision: 2, plan_digest: "digest-2" }),
      ],
      plan_reviews: [
        review({
          graph_revision: 1,
          plan_digest: "digest-1",
          status: "changes_requested",
          findings: [
            {
              id: "PV-1",
              severity: "critical",
              observation: "Compressed.",
              remediation: "Split it.",
            },
          ],
        }),
        review({
          validator_id: "plan-val-2",
          graph_revision: 2,
          plan_digest: "digest-2",
          status: "approved",
        }),
      ],
    }) as WorkflowState;
    const result = buildPlanValidatorNodes({ state });
    expect(result.nodes.map((n) => n.id)).toEqual([
      "node-plan-validator-r1",
      "node-plan-validator-r2",
    ]);
    const pushback = result.edges.find((edge) => edge.kind === "pushback");
    expect(pushback?.source).toBe("node-plan-validator-r1");
    expect(pushback?.target).toBe("node-plan-validator-r2");
    // No pushback/signoff edge closes a cycle back onto round 1's own node — only its own initial
    // dispatch (`spawn`, from the plan node) legitimately targets it.
    expect(
      result.edges.some(
        (edge) => edge.target === "node-plan-validator-r1" && edge.kind !== "spawn",
      ),
    ).toBe(false);
    const signoff = result.edges.find((edge) => edge.kind === "signoff");
    expect(signoff?.source).toBe("node-plan-validator-r2");
    expect(signoff?.target).toBe("node-orchestrator-plan");
  });

  test("an open assignment with no review yet renders a node but no verdict edge", () => {
    const state = makeState([makeTask("T-1")], {
      plan_validation_history: [round({ status: "assigned" })],
    }) as WorkflowState;
    const result = buildPlanValidatorNodes({ state });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges.every((edge) => edge.kind === "spawn")).toBe(true);
  });
});

describe("generateGraphDataset wiring", () => {
  test("a rejected plan-validation round surfaces as a pushback edge in the exported dataset", () => {
    const state = makeState([makeTask("T-1")], {
      plan_validation_history: [round()],
      plan_reviews: [
        review({
          status: "changes_requested",
          findings: [
            {
              id: "PV-1",
              severity: "critical",
              observation: "Compressed.",
              remediation: "Split it.",
            },
          ],
        }),
      ],
    }) as WorkflowState;
    const dataset = generateGraphDataset({ runId: "run-1", state });
    expect(dataset.nodes.some((node) => node.id === "node-plan-validator-r1")).toBe(true);
    expect(
      dataset.edges.some(
        (edge) => edge.kind === "pushback" && edge.source === "node-plan-validator-r1",
      ),
    ).toBe(true);
  });
});

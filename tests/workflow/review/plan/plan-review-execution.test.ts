import { describe, expect, test } from "bun:test";
import { beginPlanValidation } from "../../../../olt/scripts/src/workflow/plan-review/begin-plan-validation.ts";
import { recordPlanReview } from "../../../../olt/scripts/src/workflow/plan-review/record-plan-review.ts";
import { currentPlanDigest } from "../../../../olt/scripts/src/workflow/plan-review/plan-digest.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import {
  clock,
  compiledPort,
  compiledPortWithDependency,
  fourAnswers,
  registerAgent,
} from "../fixtures/plan-review-fixture.ts";
import { TestPort, workflowState } from "../../shared/test-port.ts";

describe("beginPlanValidation", () => {
  test("opens an assignment against the compiled plan", () => {
    const port = compiledPort();
    const { state, token } = beginPlanValidation(port, "plan-val-1", { clock });
    expect(token).toBeTruthy();
    expect(state.plan_validation?.validator_id).toBe("plan-val-1");
    expect(state.plan_validation?.status).toBe("assigned");
    expect(state.plan_validation?.graph_revision).toBe(1);
    expect(state.plan_validation?.plan_digest).toBe(currentPlanDigest(port.read()));
    expect(state.plan_validation_history).toHaveLength(1);
  });

  test("refuses when the plan is not compiled", () => {
    const state = workflowState();
    delete (state as { graph_revision?: number }).graph_revision;
    const port = new TestPort(state);
    expect(() => beginPlanValidation(port, "plan-val-1", { clock })).toThrow(/not compiled/);
  });

  test("refuses a validator that is the coordinator or planner", () => {
    const port = compiledPort();
    registerAgent(port, "plan-val-1", "coordinator");
    expect(() => beginPlanValidation(port, "plan-val-1", { clock })).toThrow(/independent/);
  });

  test("refuses a second open assignment against the same graph revision", () => {
    const port = compiledPort();
    beginPlanValidation(port, "plan-val-1", { clock });
    expect(() => beginPlanValidation(port, "plan-val-2", { clock })).toThrow(/already active/);
  });

  test("allows a fresh assignment once the graph revision moves on from a dangling one", () => {
    const port = compiledPort();
    beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "graph-revised", {}, (draft) => {
      draft.graph_revision = 2;
    });
    const { state } = beginPlanValidation(port, "plan-val-2", { clock });
    expect(state.plan_validation?.validator_id).toBe("plan-val-2");
    expect(state.plan_validation?.graph_revision).toBe(2);
  });

  test("refuses the same validator reopening a revision it already reviewed", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "approved",
        summary: "Sound.",
        ...fourAnswers,
      },
      clock,
    );
    expect(() => beginPlanValidation(port, "plan-val-1", { clock })).toThrow(/already recorded/);
  });

  test("refuses invalid leaseSeconds", () => {
    const port = compiledPort();
    expect(() => beginPlanValidation(port, "plan-val-1", { leaseSeconds: 1, clock })).toThrow(
      "lease_seconds must be an integer from 5 to 86400",
    );
    expect(() => beginPlanValidation(port, "plan-val-1", { leaseSeconds: 100_000, clock })).toThrow(
      "lease_seconds must be an integer from 5 to 86400",
    );
    expect(() => beginPlanValidation(port, "plan-val-1", { leaseSeconds: 1.5, clock })).toThrow(
      "lease_seconds must be an integer from 5 to 86400",
    );
  });
});

describe("claimTask refuses a rejected plan revision", () => {
  test("blocks an implementer claim while plan_review is changes_requested for the live revision", () => {
    const port = compiledPort();
    port.transact("test", "plan-reviewed", {}, (draft) => {
      draft.plan_review = {
        validator_id: "plan-val-1",
        packet_id: "direct",
        graph_revision: 1,
        plan_digest: "x",
        summary: "No.",
        status: "changes_requested",
        decomposition_answer: "a",
        dependency_answer: "b",
        gate_answer: "c",
        straggler_answer: "d",
        findings: [{ id: "PV-1", severity: "critical", observation: "x", remediation: "y" }],
        dependency_edges_reviewed: [],
        gate_ids_reviewed: ["G-1"],
        checks: [],
        reviewed_at: clock.now().toISOString(),
        review_sha256: "z",
      };
    });
    expect(() => claimTask(port, "T-1", "worker-1", "implementer", { clock })).toThrow(
      /plan validation rejected/,
    );
  });

  test("does not block a claim once the plan_review targets a superseded revision", () => {
    const port = compiledPort();
    port.transact("test", "plan-reviewed", {}, (draft) => {
      draft.plan_review = {
        validator_id: "plan-val-1",
        packet_id: "direct",
        graph_revision: 1,
        plan_digest: "x",
        summary: "No.",
        status: "changes_requested",
        decomposition_answer: "a",
        dependency_answer: "b",
        gate_answer: "c",
        straggler_answer: "d",
        findings: [{ id: "PV-1", severity: "critical", observation: "x", remediation: "y" }],
        dependency_edges_reviewed: [],
        gate_ids_reviewed: ["G-1"],
        checks: [],
        reviewed_at: clock.now().toISOString(),
        review_sha256: "z",
      };
      draft.graph_revision = 2;
    });
    const { state } = claimTask(port, "T-1", "worker-1", "implementer", { clock });
    expect(state.tasks["T-1"]?.status).toBe("leased");
  });

  test("does not block a claim once the plan_review approves the live revision", () => {
    const port = compiledPort();
    port.transact("test", "plan-reviewed", {}, (draft) => {
      draft.plan_review = {
        validator_id: "plan-val-1",
        packet_id: "direct",
        graph_revision: 1,
        plan_digest: "x",
        summary: "Sound.",
        status: "approved",
        decomposition_answer: "a",
        dependency_answer: "b",
        gate_answer: "c",
        straggler_answer: "d",
        findings: [],
        dependency_edges_reviewed: [],
        gate_ids_reviewed: ["G-1"],
        checks: [],
        reviewed_at: clock.now().toISOString(),
        review_sha256: "z",
      };
    });
    const { state } = claimTask(port, "T-1", "worker-1", "implementer", { clock });
    expect(state.tasks["T-1"]?.status).toBe("leased");
  });

  test("a run that never dispatched a plan-validator claims exactly as before", () => {
    const port = compiledPort();
    const { state } = claimTask(port, "T-1", "worker-1", "implementer", { clock });
    expect(state.tasks["T-1"]?.status).toBe("leased");
  });
});

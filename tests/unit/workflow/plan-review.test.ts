import { describe, expect, test } from "bun:test";
import { beginPlanValidation } from "../../../olt/scripts/src/workflow/plan-review/begin-plan-validation.ts";
import { recordPlanReview } from "../../../olt/scripts/src/workflow/plan-review/record-plan-review.ts";
import { currentPlanDigest } from "../../../olt/scripts/src/workflow/plan-review/plan-digest.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import {
  clock,
  compiledPort,
  compiledPortWithDependency,
  fourAnswers,
  registerAgent,
} from "./plan-review-fixture.ts";
import { TestPort, workflowState } from "./test-port.ts";

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
});

describe("recordPlanReview", () => {
  test("records an approved verdict with no findings", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    const state = recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "approved",
        summary: "Decomposition is sound.",
        ...fourAnswers,
      },
      clock,
    );
    expect(state.plan_review?.status).toBe("approved");
    expect(state.plan_review?.findings).toEqual([]);
    expect(state.plan_validation?.status).toBe("reviewed");
    expect(state.plan_validation_history?.[0]?.status).toBe("reviewed");
  });

  test("records a changes_requested verdict with structured findings", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    const state = recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "changes_requested",
        summary: "Compressed decomposition.",
        ...fourAnswers,
        findings: [
          {
            id: "PV-1",
            invariant: "A2-parallelism",
            severity: "critical",
            observation: "Ten topics compressed into one task.",
            remediation: "One task per topic.",
          },
        ],
      },
      clock,
    );
    expect(state.plan_review?.status).toBe("changes_requested");
    expect(state.plan_review?.findings).toHaveLength(1);
  });

  test("refuses changes_requested with no findings", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "changes_requested",
          summary: "No.",
          ...fourAnswers,
          findings: [],
        },
        clock,
      ),
    ).toThrow(/at least one finding/);
  });

  test("refuses an approved verdict that carries findings", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
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
          findings: [{ id: "PV-1", severity: "minor", observation: "x", remediation: "y" }],
        },
        clock,
      ),
    ).toThrow(/cannot carry findings/);
  });

  test("refuses a mismatched token", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: "wrong-token",
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
        },
        clock,
      ),
    ).toThrow(/authentication is invalid/);
  });

  test("refuses a review recorded after the plan changed underneath the validator", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "plan-recompiled", {}, (draft) => {
      // The digest is built from tasks/requirements/gates/graph_revision (what `workflowPort`
      // actually round-trips) — mutate one of those, not the raw `graph` document, which never
      // survives the projection at all (see `plan-digest.ts`'s own comment on why).
      draft.tasks["T-1"]!.write_scope = ["src/owned-2"];
    });
    expect(() =>
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
      ),
    ).toThrow(/changed since validation started/);
  });

  test("missing written answers are refused", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          decomposition_answer: "ok",
          // dependency_answer, gate_answer, straggler_answer all missing
        },
        clock,
      ),
    ).toThrow();
  });

  test("an approval omitting a real gate id is refused", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
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
          gate_ids_reviewed: [],
        },
        clock,
      ),
    ).toThrow(/gate_ids_reviewed omits mandatory gates/);
  });

  test("an approval naming a gate id the plan does not declare is refused", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
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
          gate_ids_reviewed: ["G-1", "G-does-not-exist"],
        },
        clock,
      ),
    ).toThrow(/gate_ids_reviewed names gates the compiled plan does not declare/);
  });

  test("an approval omitting a real dependency edge is refused", () => {
    const port = compiledPortWithDependency();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
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
          gate_ids_reviewed: ["G-1", "G-2"],
          dependency_edges_reviewed: [],
        },
        clock,
      ),
    ).toThrow(/dependency_edges_reviewed omits real edges/);
  });

  test("an approval naming a dependency edge the plan does not declare is refused", () => {
    const port = compiledPortWithDependency();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
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
          gate_ids_reviewed: ["G-1", "G-2"],
          dependency_edges_reviewed: [
            { from: "T-2", to: "T-1" },
            { from: "T-2", to: "T-does-not-exist" },
          ],
        },
        clock,
      ),
    ).toThrow(/dependency_edges_reviewed names edges the compiled plan does not declare/);
  });

  test("an approval naming exactly the real dependency edges and gates is recorded", () => {
    const port = compiledPortWithDependency();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    const state = recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "approved",
        summary: "Sound.",
        ...fourAnswers,
        gate_ids_reviewed: ["G-2", "G-1"],
        dependency_edges_reviewed: [{ from: "T-2", to: "T-1" }],
      },
      clock,
    );
    expect(state.plan_review?.dependency_edges_reviewed).toEqual([{ from: "T-2", to: "T-1" }]);
    expect(state.plan_review?.gate_ids_reviewed).toEqual(["G-2", "G-1"]);
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

import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { buildStateTransitions } from "../../../../olt/scripts/src/summary/markdown/index.ts";
import { makeEvent, makeState, makeTask } from "../dag/graph-fixtures.ts";

describe("state transitions", () => {
  const task = makeTask("T-1", {
    status: "done",
    probe_round: 1,
    repair_round: 1,
    history: [
      {
        at: "2026-08-14T20:00:00.000Z",
        actor: "worker-1",
        from: "ready",
        to: "leased",
        reason: "claimed",
        attempt: 1,
      },
      {
        at: "2026-08-14T20:20:00.000Z",
        actor: "val-1",
        from: "validating",
        to: "changes_requested",
        reason: "review",
        attempt: 1,
      },
    ],
  });

  test("mirror task.history as harness-observed moves", () => {
    const transitions = buildStateTransitions(task);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toEqual({
      at: "2026-08-14T20:00:00.000Z",
      actor: "worker-1",
      from: "ready",
      to: "leased",
      reason: "claimed",
      attempt: 1,
      evidence_class: "harness_observed",
    });
  });

  test("absorb the enriched review payload and record the probe round separately", () => {
    const events = [
      makeEvent("probe-recorded", 1, "2026-08-14T20:10:00.000Z", "val-1", {
        task_id: "T-1",
        round: 1,
        finding_ids: ["F-demand"],
      }),
      makeEvent("review-recorded", 2, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "reject",
        round: 1,
        class: "defect",
        finding_count: 2,
      }),
    ];
    const transitions = buildStateTransitions(task, events);

    const probe = transitions.find((entry) => entry.verdict === "probe");
    expect(probe?.from).toBe("validating");
    expect(probe?.to).toBe("validating");
    expect(probe?.round).toBe(1);
    expect(probe?.findingCount).toBe(1);

    const review = transitions.find((entry) => entry.to === "changes_requested");
    expect(review?.verdict).toBe("reject");
    expect(review?.findingClass).toBe("defect");
    expect(review?.findingCount).toBe(2);
  });

  test("refuse to label a pass with the class of the findings it closed", () => {
    const passing = makeTask("T-1", {
      status: "done",
      history: [
        {
          at: "2026-08-14T20:20:00.000Z",
          actor: "val-1",
          from: "validating",
          to: "validated",
          reason: "review",
          attempt: 1,
        },
      ],
    });
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "pass",
        round: 0,
        class: "probe_demand",
        finding_count: 0,
        resolved_count: 1,
      }),
    ];
    const review = buildStateTransitions(passing, events).find((entry) => entry.to === "validated");
    expect(review?.verdict).toBe("pass");
    expect(review?.findingClass).toBeUndefined();
    expect(review?.findingCount).toBe(0);
  });

  test("derives the finding class from the referenced findings when the payload omits it", () => {
    const withFindings = makeTask("T-1", {
      status: "changes_requested",
      findings: [
        {
          id: "F-1",
          requirement_id: "REQ-T-1",
          severity: "important",
          observation: "Missing null check",
          remediation: "Add a guard",
          revalidation: "Re-run the gate",
          status: "open",
          class: "defect",
          evidence: [],
        },
        {
          id: "F-2",
          requirement_id: "REQ-T-1",
          severity: "important",
          observation: "Missing null check elsewhere",
          remediation: "Add a guard",
          revalidation: "Re-run the gate",
          status: "open",
          class: "defect",
          evidence: [],
        },
      ],
      history: [
        {
          at: "2026-08-14T20:20:00.000Z",
          actor: "val-1",
          from: "validating",
          to: "changes_requested",
          reason: "review",
          attempt: 1,
        },
      ],
    });
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "reject",
        finding_ids: ["F-1", "F-2"],
      }),
    ];
    const review = buildStateTransitions(withFindings, events).find(
      (entry) => entry.to === "changes_requested",
    );
    expect(review?.findingClass).toBe("defect");
  });

  test("declines to guess a finding class when the referenced findings disagree", () => {
    const mixedFindings = makeTask("T-1", {
      status: "changes_requested",
      findings: [
        {
          id: "F-1",
          requirement_id: "REQ-T-1",
          severity: "important",
          observation: "Missing null check",
          remediation: "Add a guard",
          revalidation: "Re-run the gate",
          status: "open",
          class: "defect",
          evidence: [],
        },
        {
          id: "F-2",
          requirement_id: "REQ-T-1",
          severity: "minor",
          observation: "Prove the retry path",
          remediation: "Record a command demonstrating it",
          revalidation: "Re-run the gate",
          status: "open",
          class: "probe_demand",
          evidence: [],
        },
      ],
      history: [
        {
          at: "2026-08-14T20:20:00.000Z",
          actor: "val-1",
          from: "validating",
          to: "changes_requested",
          reason: "review",
          attempt: 1,
        },
      ],
    });
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", {
        task_id: "T-1",
        verdict: "reject",
        finding_ids: ["F-1", "F-2"],
      }),
    ];
    const review = buildStateTransitions(mixedFindings, events).find(
      (entry) => entry.to === "changes_requested",
    );
    expect(review?.findingClass).toBeUndefined();
  });

  test("tolerate a capsule whose review events carry only a task id", () => {
    const events = [
      makeEvent("review-recorded", 1, "2026-08-14T20:20:00.000Z", "val-1", { task_id: "T-1" }),
    ];
    const review = buildStateTransitions(task, events).find(
      (entry) => entry.to === "changes_requested",
    );
    expect(review?.verdict).toBeUndefined();
    expect(review?.findingCount).toBeUndefined();
    expect(review?.evidence_class).toBe("harness_observed");
  });

  test("land on the implementer node and nowhere else", () => {
    const dataset = generateGraphDataset({
      runId: "run-transitions",
      state: makeState([task]),
    });
    const withTransitions = dataset.nodes.filter((node) => node.stateTransitions !== undefined);
    expect(withTransitions.map((node) => node.id)).toEqual(["node-task-T-1"]);
    expect(withTransitions[0]?.stateTransitions).toHaveLength(2);
  });
});

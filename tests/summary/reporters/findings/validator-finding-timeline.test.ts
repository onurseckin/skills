import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { collectTimeline } from "../../../../olt/scripts/src/summary/metrics/index.ts";
import { cleanupVirtualSummaryFS, setupVirtualSummaryFS } from "../../fixture.ts";
import { makeEvent, makeState, makeTask } from "../dag/graph-fixtures.ts";

beforeEach(() => {
  setupVirtualSummaryFS();
});

afterEach(() => {
  cleanupVirtualSummaryFS();
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

  test("edge cases: clean task with zero findings and empty validations", () => {
    const cleanTask = makeTask("T-clean", {
      label: "Clean Task",
      status: "succeeded",
      validations: [],
      findings: [],
    });

    const dataset = generateGraphDataset({
      runId: "run-clean",
      state: makeState([cleanTask]),
      promptText: "Clean run",
    });

    const taskNode = dataset.nodes.find((n) => n.id === "node-task-T-clean");
    expect(taskNode).toBeDefined();
    expect(taskNode?.assets).toBeUndefined();
    expect(taskNode?.metadata?.findings).toBeUndefined();
  });

  test("edge cases: finding with no screenshots or evidence references", () => {
    const taskWithPlainFinding = makeTask("T-no-evidence", {
      status: "changes_requested",
      repair_round: 1,
      findings: [
        {
          id: "F-NO-EVID",
          requirement_id: "REQ-1",
          severity: "low",
          observation: "Typo in comment",
          remediation: "Fix typo",
          revalidation: "Review diff",
          status: "open",
        },
      ],
      validations: [
        {
          validator_id: "val-linter",
          domain: "code-quality",
          verdict: "reject",
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-no-evidence",
      state: makeState([taskWithPlainFinding]),
      promptText: "Check typos",
    });

    const valNode = dataset.nodes.find((n) => n.id === "node-validator-T-no-evidence");
    expect(valNode).toBeDefined();
    expect(valNode?.assets).toBeUndefined();
    const finding = valNode?.metadata?.findings?.[0];
    expect(finding?.id).toBe("F-NO-EVID");
    expect(finding?.screenshotAssetIds).toBeUndefined();
  });

  test("edge cases: sparse timeline telemetry with missing optional metrics", () => {
    const sparseEvents = [
      makeEvent("task-validation-started", 1, "2026-08-15T19:00:00.000Z", "validator-sparse", {
        task_id: "T-sparse",
      }),
      makeEvent("review-recorded", 2, "2026-08-15T19:05:00.000Z", "validator-sparse", {
        task_id: "T-sparse",
        verdict: "approve",
      }),
    ];

    const timeline = collectTimeline(sparseEvents, 1024);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].pushback_reason).toBeUndefined();
    expect(timeline[1].findings).toBeUndefined();
    expect(timeline[1].duration_ms).toBeUndefined();
    expect(timeline[1].tokens).toBeUndefined();
  });
});

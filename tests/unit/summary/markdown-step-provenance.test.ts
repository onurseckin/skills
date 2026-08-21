import { describe, expect, test } from "bun:test";
import type {
  ActionStepRecord,
  GraphDataset,
} from "../../../orchestrating-long-tasks/scripts/src/summary/types.ts";
import { emptyGraph, emptyState, render } from "./markdown-fixtures.ts";

function graphWithSteps(steps: ActionStepRecord[]): GraphDataset {
  return {
    id: "g",
    title: "g",
    nodes: [],
    edges: [],
    run: {
      runId: "unit-run",
      prompt: { text: "Do the thing.", bytes: 13, evidence_class: "harness_observed" },
      steps,
    },
  };
}

/**
 * B15.1's markdown side: `RunFacts.steps` is the same array `graph.json` carries under `run.steps`
 * (`file-provenance-wiring.test.ts` proves the producer populates it); this proves `summary.md`
 * renders that exact array rather than a re-derived timeline of its own.
 */
describe("summary.md: action provenance trace (B15.1)", () => {
  test("no run was given a graph: the section says so, not an empty table", () => {
    const markdown = render(emptyState, { graph: emptyGraph });
    expect(markdown).toContain("## 19. Action Provenance Trace");
    expect(markdown).toContain("The capsule recorded no step.");
  });

  test("a step's kind, target, outcome and evidence all reach the page", () => {
    const graph = graphWithSteps([
      {
        step: 9,
        timestamp: "2026-08-19T00:02:00.000Z",
        actor: "worker-1",
        kind: "task",
        rawKind: "task-submitted",
        target: { taskId: "T-1", nodeId: "node-task-T-1" },
        outcome: "success",
        evidence_class: "harness_observed",
        summary: "worker-1 submitted T-1",
      },
    ]);
    const markdown = render(emptyState, { graph });
    const section = markdown.slice(
      markdown.indexOf("## 19. Action Provenance Trace"),
      markdown.indexOf("## 20. Standing Checklist Coverage"),
    );
    expect(section).toContain(
      "| 9 | 2026-08-19T00:02:00.000Z | `worker-1` | task | `task-submitted` | taskId=T-1 nodeId=node-task-T-1 | success | harness_observed | worker-1 submitted T-1 |",
    );
  });

  test("a target field's rendered order is fixed, not the object's own insertion order", () => {
    const graph = graphWithSteps([
      {
        step: 4,
        timestamp: "2026-08-19T00:00:00.000Z",
        actor: "coordinator-1",
        kind: "branch",
        rawKind: "branch-claimed",
        // Inserted out of the fixed order (`taskId` before `branchId`) to prove the renderer sorts
        // by its own template rather than echoing whatever order the payload built the object in.
        target: { subTaskId: "S-1", branchId: "B-1", agentId: "sub-1" },
        outcome: "success",
        evidence_class: "harness_observed",
        summary: "sub-1 claimed S-1",
      },
    ]);
    const markdown = render(emptyState, { graph });
    expect(markdown).toContain("branchId=B-1 subTaskId=S-1 agentId=sub-1");
  });

  test("a target with no field the chain resolved renders as none, not a blank cell", () => {
    const graph = graphWithSteps([
      {
        step: 1,
        timestamp: "2026-08-19T00:00:00.000Z",
        actor: "coordinator-1",
        kind: "run",
        rawKind: "capsule-initialized",
        target: {},
        outcome: "success",
        evidence_class: "harness_observed",
        summary: "capsule initialized",
      },
    ]);
    const markdown = render(emptyState, { graph });
    expect(markdown).toContain(
      "| 1 | 2026-08-19T00:00:00.000Z | `coordinator-1` | run | `capsule-initialized` | none | success | harness_observed | capsule initialized |",
    );
  });

  test("an unverdicted action's outcome renders as unknown, never a guessed success", () => {
    const graph = graphWithSteps([
      {
        step: 5,
        timestamp: "2026-08-19T00:00:00.000Z",
        actor: "validator-1",
        kind: "review",
        rawKind: "review-recorded",
        target: { taskId: "T-1" },
        outcome: "unknown",
        evidence_class: "harness_observed",
        summary: "validator-1 recorded a review of T-1 with no stated verdict",
      },
    ]);
    const markdown = render(emptyState, { graph });
    expect(markdown).toMatch(
      /\| review \| `review-recorded` \| taskId=T-1 \| unknown \| harness_observed \|/,
    );
  });

  test("steps render in the chain's own order, not resorted", () => {
    const graph = graphWithSteps([
      {
        step: 3,
        timestamp: "2026-08-19T00:00:01.000Z",
        actor: "worker-1",
        kind: "lease",
        rawKind: "task-claimed",
        target: { taskId: "T-1" },
        outcome: "success",
        evidence_class: "harness_observed",
        summary: "worker-1 claimed T-1",
      },
      {
        step: 9,
        timestamp: "2026-08-19T00:00:02.000Z",
        actor: "worker-1",
        kind: "task",
        rawKind: "task-submitted",
        target: { taskId: "T-1" },
        outcome: "success",
        evidence_class: "harness_observed",
        summary: "worker-1 submitted T-1",
      },
    ]);
    const markdown = render(emptyState, { graph });
    const section = markdown.slice(markdown.indexOf("## 19. Action Provenance Trace"));
    expect(section.indexOf("| 3 |")).toBeLessThan(section.indexOf("| 9 |"));
  });
});

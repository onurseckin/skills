import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRunFacts,
  type RunFactsInput,
} from "../../../../olt/scripts/src/summary/graph/index.ts";
import type { WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { makeEvent, makeState, makeTask } from "./graph-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRunRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "run-facts-"));
  roots.push(root);
  return root;
}

function baseInput(overrides: Partial<RunFactsInput> = {}): RunFactsInput {
  return {
    runId: "run-facts",
    state: makeState([makeTask("T-1")]),
    promptText: "Build the thing",
    branches: [],
    agents: [],
    ...overrides,
  };
}

describe("buildRunFacts: task order", () => {
  test("carries a recorded task_order, and drops non-string entries from it", () => {
    const state = {
      ...makeState([makeTask("T-1")]),
      task_order: ["T-1", 7, "T-2", null],
    } as unknown as Readonly<WorkflowState>;

    const facts = buildRunFacts(baseInput({ state }));
    expect(facts.taskOrder).toEqual(["T-1", "T-2"]);
  });

  test("omits task_order entirely when the run never recorded one", () => {
    const facts = buildRunFacts(baseInput());
    expect(facts.taskOrder).toBeUndefined();
  });
});

describe("buildRunFacts: enhanced plan", () => {
  test("reads every field of a recorded enhanced_plan entry, plus its markdown and json documents", () => {
    const runRoot = tempRunRoot();
    mkdirSync(join(runRoot, "planning"), { recursive: true });
    writeFileSync(
      join(runRoot, "planning", "enhanced-plan.json"),
      JSON.stringify({ tasks: ["T-1"] }),
    );
    writeFileSync(join(runRoot, "planning", "enhanced-plan.md"), "# Enhanced plan\n");

    const state = {
      ...makeState([makeTask("T-1")]),
      planning: {
        enhanced_plan: {
          revision: 2,
          recorded_at: "2026-08-19T00:00:00.000Z",
          actor: "orchestrator",
          prompt_sha256: "p".repeat(64),
          markdown_path: "planning/enhanced-plan.md",
          json_path: "planning/enhanced-plan.json",
          markdown_sha256: "m".repeat(64),
          json_sha256: "j".repeat(64),
        },
      },
    } as unknown as Readonly<WorkflowState>;

    const facts = buildRunFacts(baseInput({ state, runRoot }));
    expect(facts.enhancedPlan).toEqual({
      revision: 2,
      recordedAt: "2026-08-19T00:00:00.000Z",
      actor: "orchestrator",
      promptSha256: "p".repeat(64),
      markdownPath: "planning/enhanced-plan.md",
      jsonPath: "planning/enhanced-plan.json",
      markdownSha256: "m".repeat(64),
      jsonSha256: "j".repeat(64),
      markdown: "# Enhanced plan\n",
      document: { tasks: ["T-1"] },
      evidence_class: "agent_reported",
    });
  });

  test("is present from the on-disk documents alone, with no state.planning entry at all", () => {
    const runRoot = tempRunRoot();
    mkdirSync(join(runRoot, "planning"), { recursive: true });
    writeFileSync(join(runRoot, "planning", "enhanced-plan.md"), "# Plan\n");

    const facts = buildRunFacts(baseInput({ runRoot }));
    expect(facts.enhancedPlan).toEqual({ markdown: "# Plan\n", evidence_class: "agent_reported" });
  });

  test("a corrupt enhanced-plan.json is read as absent, not thrown", () => {
    const runRoot = tempRunRoot();
    mkdirSync(join(runRoot, "planning"), { recursive: true });
    writeFileSync(join(runRoot, "planning", "enhanced-plan.json"), "{ not json");
    writeFileSync(join(runRoot, "planning", "enhanced-plan.md"), "# Plan\n");

    const facts = buildRunFacts(baseInput({ runRoot }));
    expect(facts.enhancedPlan?.document).toBeUndefined();
    expect(facts.enhancedPlan?.markdown).toBe("# Plan\n");
  });

  test("is entirely absent when neither state nor disk recorded one", () => {
    const facts = buildRunFacts(baseInput());
    expect(facts.enhancedPlan).toBeUndefined();
  });
});

describe("buildRunFacts: requirements", () => {
  test("reads the requirements document's own fields alongside its requirement and disposition lists", () => {
    const state = {
      ...makeState([makeTask("T-1")]),
      requirements: {
        schema: "requirements.v1",
        version: 3,
        prompt_sha256: "r".repeat(64),
        requirements: [{ id: "REQ-1" }],
        dispositions: [{ requirement_id: "REQ-1", status: "satisfied" }],
      },
    } as unknown as Readonly<WorkflowState>;

    const facts = buildRunFacts(baseInput({ state }));
    expect(facts.requirements).toEqual({
      schema: "requirements.v1",
      version: 3,
      promptSha256: "r".repeat(64),
      requirements: [{ id: "REQ-1" }],
      dispositions: [{ requirement_id: "REQ-1", status: "satisfied" }],
      evidence_class: "derived",
    });
  });

  test("is absent when the document carries neither a requirement nor a disposition", () => {
    const state = {
      ...makeState([makeTask("T-1")]),
      requirements: { schema: "requirements.v1", requirements: [], dispositions: [] },
    } as unknown as Readonly<WorkflowState>;

    expect(buildRunFacts(baseInput({ state })).requirements).toBeUndefined();
  });

  test("is absent when the run never recorded a requirements document", () => {
    expect(buildRunFacts(baseInput()).requirements).toBeUndefined();
  });
});

describe("buildRunFacts: reports", () => {
  test("reads every *.json report in the capsule's reports directory, sorted by name", () => {
    const runRoot = tempRunRoot();
    mkdirSync(join(runRoot, "reports"), { recursive: true });
    writeFileSync(join(runRoot, "reports", "T-2-review.json"), JSON.stringify({ task_id: "T-2" }));
    writeFileSync(join(runRoot, "reports", "T-1-review.json"), JSON.stringify({ task_id: "T-1" }));
    writeFileSync(join(runRoot, "reports", "notes.txt"), "not a report");

    const facts = buildRunFacts(baseInput({ runRoot }));
    expect(facts.reports).toEqual([
      {
        path: join("reports", "T-1-review.json"),
        document: { task_id: "T-1" },
        evidence_class: "harness_observed",
      },
      {
        path: join("reports", "T-2-review.json"),
        document: { task_id: "T-2" },
        evidence_class: "harness_observed",
      },
    ]);
  });

  test("is absent without a runRoot, and without a reports directory on disk", () => {
    expect(buildRunFacts(baseInput()).reports).toBeUndefined();
    const runRoot = tempRunRoot();
    expect(buildRunFacts(baseInput({ runRoot })).reports).toBeUndefined();
  });
});

describe("buildRunFacts: events", () => {
  test("carries every event stripped of its own state projection, never that projection itself", () => {
    const events = [
      makeEvent("task-claimed", 1, "2026-08-19T00:00:00.000Z", "worker-1", { task_id: "T-1" }),
    ];

    const facts = buildRunFacts(baseInput({ events }));
    expect(facts.events).toHaveLength(1);
    expect(facts.events?.[0]?.kind).toBe("task-claimed");
    expect(facts.events?.[0]?.actor).toBe("worker-1");
    expect(facts.events?.[0]).not.toHaveProperty("projection");
  });

  test("is absent when the run carried no events at all", () => {
    expect(buildRunFacts(baseInput()).events).toBeUndefined();
    expect(buildRunFacts(baseInput({ events: [] })).events).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function freshRun(label: string): string {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  return initRun(repo, `store-ports-run-${label}`, new TextEncoder().encode("prompt"), "file", true);
}

function seedMinimalPlan(run: string): void {
  transact(run, "test-setup", "seed-graph", {}, (draft) => {
    draft.graph = { revision: 1, gates: [] };
    draft.requirements = { requirements: [] };
    draft.tasks = {};
  });
}

describe("workflowPort (integration/store-ports)", () => {
  test("read() gracefully returns an empty workflow structure when no plan is applied yet", () => {
    const run = freshRun("no-plan");
    const state = workflowPort(run).read();
    expect(state.tasks).toEqual({});
    expect(state.requirements).toEqual([]);
    expect(state.gates).toEqual([]);
    expect(state.commands).toEqual({});
    expect(state.orphan_evidence).toEqual([]);
    expect(state.graph_revision).toBeUndefined();
  });

  test("read() normalizes task records with defaults for missing array and integer properties", () => {
    const run = freshRun("task-normalization");
    transact(run, "test-setup", "seed-tasks", {}, (draft) => {
      draft.graph = { revision: 1, gates: [] };
      draft.tasks = {
        "task-minimal": {
          id: "task-minimal",
          status: "ready",
          type: "task",
          priority: 50,
          effort: 1,
        },
        "task-complete": {
          id: "task-complete",
          status: "ready",
          type: "task",
          priority: 50,
          effort: 1,
          requirement_ids: ["req-1"],
          write_scope: ["src/**"],
          dependencies: ["task-minimal"],
          attempts: [],
          history: [],
          repair_round: 2,
        },
      };
    });

    const state = workflowPort(run).read();
    const minTask = state.tasks["task-minimal"];
    expect(minTask.requirement_ids).toEqual([]);
    expect(minTask.write_scope).toEqual([]);
    expect(minTask.dependencies).toEqual([]);
    expect(minTask.attempts).toEqual([]);
    expect(minTask.history).toEqual([]);
    expect(minTask.repair_round).toBe(0);

    const compTask = state.tasks["task-complete"];
    expect(compTask.repair_round).toBe(2);
    expect(compTask.requirement_ids).toEqual(["req-1"]);
  });

  test("read() copies all optional workflow state fields when present", () => {
    const run = freshRun("all-optional-fields");
    const optionalFields = {
      current_repository_binding: {
        schema: "harness.repository-binding",
        version: 1,
        inspection_sha256: "insp-1",
        git_identity_sha256: "git-1",
        content_sha256: "content-1",
        total_bytes: 10,
        file_count: 1,
      },
      completion: { note: "completed" },
      branches: { "b-1": { name: "feat" } },
      packets: { "p-1": { id: "p-1" } },
      orphan_evidence_dispositions: { "d-1": { id: "d-1" } },
      completion_critic: { id: "c-1" },
      completion_critic_history: [{ id: "h-1" }],
      completion_review: { id: "cr-1" },
      completion_reviews: [{ id: "cr-1" }],
      completion_remediations: [{ id: "rem-1" }],
      completion_verification: { id: "cv-1" },
      completion_result: { id: "res-1" },
      plan_validation: { id: "pv-1" },
      plan_reviews: [{ id: "pr-1" }],
      gate_proofs: [{ id: "gp-1" }],
    };

    transact(run, "test-setup", "seed-all-optional", {}, (draft) => {
      draft.graph = { revision: 1, gates: [] };
      draft.requirements = { requirements: [] };
      draft.tasks = {};
      Object.assign(draft, optionalFields);
    });

    const state = workflowPort(run).read();
    for (const [key, value] of Object.entries(optionalFields)) {
      expect((state as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  test("read() refuses a graph with a non-positive or non-integer revision", () => {
    const run = freshRun("bad-revision");
    seedMinimalPlan(run);
    transact(run, "test-setup", "corrupt-revision", {}, (draft) => {
      (draft.graph as { revision: number }).revision = 0;
    });
    expect(() => workflowPort(run).read()).toThrow(/valid graph revision/i);

    transact(run, "test-setup", "corrupt-revision-again", {}, (draft) => {
      (draft.graph as { revision: number }).revision = 1.5;
    });
    expect(() => workflowPort(run).read()).toThrow(/valid graph revision/i);
  });

  test("read() carries an object-shaped completion field through, but not an array or null one", () => {
    const run = freshRun("completion-field");
    seedMinimalPlan(run);

    expect(workflowPort(run).read().completion).toBeUndefined();

    transact(run, "test-setup", "seed-completion", {}, (draft) => {
      draft.completion = { note: "wrapped up" };
    });
    expect(workflowPort(run).read().completion).toEqual({ note: "wrapped up" });
  });

  test("transact() round-trips a workflow mutation back through the same shape", () => {
    const run = freshRun("transact-roundtrip");
    seedMinimalPlan(run);
    const port = workflowPort(run);

    const after = port.transact("test-actor", "noop", {}, () => {});
    expect(after.graph_revision).toBe(1);
    expect(after.tasks).toEqual({});
  });

  test("transact() initializes draft.requirements and draft.graph when they are missing or non-objects", () => {
    const run = freshRun("transact-init-fields");
    const port = workflowPort(run);

    port.transact("test-actor", "init-reqs-graph", {}, (draftWorkflow) => {
      draftWorkflow.requirements = [
        {
          id: "req-1",
          instruction: "do something",
          source_excerpt: "excerpt",
          source_lines: [1],
          disposition: "actionable",
          priority: 50,
          risk: "low",
          acceptance: [],
          ambiguity: [],
          dependencies: [],
          evidence: [],
          status: "planned",
        } as never,
      ];
      draftWorkflow.gates = [
        {
          id: "gate-1",
          scope: "task",
          command: ["bun", "test"],
          cwd: ".",
          mandatory: true,
          requirement_ids: ["req-1"],
        },
      ];
      draftWorkflow.graph_revision = 2;
    });

    const readState = port.read();
    expect(readState.requirements.length).toBe(1);
    expect(readState.gates.length).toBe(1);
    expect(readState.graph_revision).toBe(2);
  });
});

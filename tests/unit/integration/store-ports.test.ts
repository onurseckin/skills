import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function freshRun(label: string): string {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo);
  return initRun(repo, "store-ports-run", new TextEncoder().encode("prompt"), "file", true);
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
});

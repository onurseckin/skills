import { describe, expect, test } from "bun:test";
import { proposeBatch } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { schedulerState } from "./fixtures.ts";

describe("scheduler batches", () => {
  test("batch ranking is deterministic in the documented direction", () => {
    const batch = proposeBatch(schedulerState());
    expect(batch.map(({ id }) => id)).toEqual([
      "priority",
      "deep",
      "wide",
      "narrow",
      "older",
      "newer",
      "low-effort",
      "high-effort",
      "lex-a",
      "lex-b",
      "lex.zero",
      "lex:zero",
    ]);
  });

  test("refuses to schedule before a plan (graph and tasks) has been applied", () => {
    expect(() => proposeBatch({})).toThrow(/plan must be applied/i);
    expect(() => proposeBatch({ graph: {} })).toThrow(/plan must be applied/i);
    expect(() => proposeBatch({ graph: {}, tasks: "not-a-record" })).toThrow(
      /plan must be applied/i,
    );
  });

  test("batch honors dependencies max parallel and deep copy safety", () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    for (const id of Object.keys(tasks)) {
      if (id !== "deep" && id !== "deep-child") tasks[id]!.status = "blocked";
    }
    expect(proposeBatch(state).map(({ id }) => id)).toEqual(["deep"]);
    tasks.deep!.status = "done";
    const batch = proposeBatch(state, 1);
    expect(batch.map(({ id }) => id)).toEqual(["deep-child"]);
    batch[0]!.status = "tampered";
    expect(tasks["deep-child"]!.status).toBe("proposed");
    for (const invalid of [0, -1, true, 1.5]) {
      expect(() => proposeBatch(state, invalid as number)).toThrow();
    }
  });

  test("batch excludes identical and ancestor-descendant write conflicts", () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    Object.assign(tasks, {
      "scope-parent": {
        id: "scope-parent",
        status: "ready",
        priority: 20,
        created_order: 1,
        effort: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        write_scope: ["src"],
        dependencies: [],
      },
      "scope-child": {
        id: "scope-child",
        status: "ready",
        priority: 19,
        created_order: 1,
        effort: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        write_scope: ["src/module"],
        dependencies: [],
      },
      "scope-identical": {
        id: "scope-identical",
        status: "ready",
        priority: 18,
        created_order: 1,
        effort: 1,
        requirement_ids: ["R-001"],
        resource_scope: [],
        write_scope: ["src"],
        dependencies: [],
      },
    });
    const graph = state.graph as Record<string, unknown>;
    (graph.nodes as unknown[]).push(
      tasks["scope-parent"],
      tasks["scope-child"],
      tasks["scope-identical"],
    );
    const identifiers = proposeBatch(state, 3).map(({ id }) => id);
    expect(identifiers).toContain("scope-parent");
    expect(identifiers).not.toContain("scope-child");
    expect(identifiers).not.toContain("scope-identical");
    expect(identifiers).toHaveLength(3);
  });
});

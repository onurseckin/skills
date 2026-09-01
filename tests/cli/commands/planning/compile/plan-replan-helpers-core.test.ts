import { describe, expect, test } from "bun:test";
import {
  parseGateArgv,
  parentTasks,
  readPlanBindings,
  resolveClusterFindingRequirement,
  resolveClusterGate,
  type PlanBindings,
} from "../../../../../olt/scripts/src/cli/commands/plan-replan-bindings.ts";

describe("parseGateArgv", () => {
  test("splits a whitespace-separated string command", () => {
    expect(parseGateArgv("bun run typecheck")).toEqual(["bun", "run", "typecheck"]);
  });

  test("passes an array command through, keeping only string entries", () => {
    expect(parseGateArgv(["bun", "test", 7 as unknown as string])).toEqual(["bun", "test"]);
  });

  test("returns undefined for an empty or blank command", () => {
    expect(parseGateArgv("   ")).toBeUndefined();
    expect(parseGateArgv(undefined)).toBeUndefined();
    expect(parseGateArgv(null)).toBeUndefined();
    expect(parseGateArgv([])).toBeUndefined();
  });
});

describe("readPlanBindings", () => {
  test("collects task write scopes, requirement ids, and matches task-scoped gates by id convention", () => {
    const state = {
      tasks: {
        "task-core": {
          write_scope: ["src/core"],
          requirement_ids: ["R-001"],
        },
      },
      gates: [
        { id: "gate-core", scope: "task", command: "bun gate-core.ts" },
        { id: "gate-other", scope: "run", command: "bun other.ts" },
      ],
      requirements: { requirements: [{ id: "R-001" }, { id: "R-002" }] },
    };
    const bindings = readPlanBindings(state);
    expect(bindings.tasks).toHaveLength(1);
    expect(bindings.tasks[0]).toMatchObject({
      id: "task-core",
      writeScope: ["src/core"],
      requirementIds: ["R-001"],
      gate: ["bun", "gate-core.ts"],
    });
    expect(bindings.requirementIds.has("R-001")).toBe(true);
    expect(bindings.requirementIds.has("R-002")).toBe(true);
  });

  test("reads gates nested under state.graph.gates when state.gates is absent", () => {
    const state = {
      tasks: { "task-a": { write_scope: ["src/a"] } },
      graph: { gates: [{ id: "gate-a", scope: "task", command: ["bun", "a.ts"] }] },
    };
    const bindings = readPlanBindings(state);
    expect(bindings.tasks[0]!.gate).toEqual(["bun", "a.ts"]);
  });

  test("ignores non-task-scoped gates and non-object task entries", () => {
    const state = {
      tasks: { "task-a": { write_scope: ["src/a"] }, "task-b": "not-an-object" },
      gates: [{ id: "gate-a", scope: "run", command: "bun a.ts" }],
    };
    const bindings = readPlanBindings(state);
    expect(bindings.tasks).toHaveLength(1);
    expect(bindings.tasks[0]!.gate).toBeUndefined();
  });

  test("tolerates a missing tasks/requirements/gates section entirely", () => {
    const bindings = readPlanBindings({});
    expect(bindings.tasks).toEqual([]);
    expect(bindings.requirementIds.size).toBe(0);
  });

  test("matches the bare gate-<id> form when the task id already carries a task- prefix", () => {
    const state = {
      tasks: { "task-core": { write_scope: ["src/core"] } },
      gates: [{ id: "gate-task-core", scope: "task", command: "bun x.ts" }],
    };
    const bindings = readPlanBindings(state);
    expect(bindings.tasks[0]!.gate).toEqual(["bun", "x.ts"]);
  });
});

describe("parentTasks", () => {
  const bindings: PlanBindings = {
    tasks: [
      { id: "task-a", writeScope: ["src/a"], requirementIds: ["R-1"], gate: ["bun", "a.ts"] },
      { id: "task-b", writeScope: [], requirementIds: ["R-2"], gate: undefined },
    ],
    requirementIds: new Set(["R-1", "R-2"]),
  };

  test("returns only tasks whose write scope overlaps and is non-empty", () => {
    expect(parentTasks(bindings, ["src/a/file.ts"]).map((t) => t.id)).toEqual(["task-a"]);
  });

  test("returns nothing when no scope overlaps", () => {
    expect(parentTasks(bindings, ["src/unrelated"])).toEqual([]);
  });
});

describe("resolveClusterGate", () => {
  const bindings: PlanBindings = {
    tasks: [
      { id: "task-a", writeScope: ["src/a"], requirementIds: ["R-1"], gate: ["bun", "a.ts"] },
    ],
    requirementIds: new Set(["R-1"]),
  };

  test("an explicit --gate flag always wins", () => {
    const resolved = resolveClusterGate(bindings, {
      taskId: "repair-1",
      writeScope: ["src/a"],
      declared: [["bun", "declared.ts"]],
      flagGate: ["bun", "flag.ts"],
    });
    expect(resolved).toEqual({ argv: ["bun", "flag.ts"], source: "flag" });
  });

  test("a single distinct declared revalidation_gate is used when there is no flag", () => {
    const resolved = resolveClusterGate(bindings, {
      taskId: "repair-1",
      writeScope: ["src/unrelated"],
      declared: [
        ["bun", "d.ts"],
        ["bun", "d.ts"],
      ],
      flagGate: undefined,
    });
    expect(resolved).toEqual({ argv: ["bun", "d.ts"], source: "finding" });
  });

  test("throws when findings declare more than one distinct gate", () => {
    expect(() =>
      resolveClusterGate(bindings, {
        taskId: "repair-1",
        writeScope: ["src/unrelated"],
        declared: [
          ["bun", "d1.ts"],
          ["bun", "d2.ts"],
        ],
        flagGate: undefined,
      }),
    ).toThrow(/declare 2 different revalidation gates/);
  });

  test("falls back to a single inherited parent task gate", () => {
    const resolved = resolveClusterGate(bindings, {
      taskId: "repair-1",
      writeScope: ["src/a"],
      declared: [],
      flagGate: undefined,
    });
    expect(resolved).toEqual({ argv: ["bun", "a.ts"], source: "parent_task" });
  });

  test("throws when parent tasks writing the scope disagree on their gate", () => {
    const twoParents: PlanBindings = {
      tasks: [
        { id: "task-a", writeScope: ["src/shared"], requirementIds: [], gate: ["bun", "a.ts"] },
        { id: "task-b", writeScope: ["src/shared"], requirementIds: [], gate: ["bun", "b.ts"] },
      ],
      requirementIds: new Set(),
    };
    expect(() =>
      resolveClusterGate(twoParents, {
        taskId: "repair-1",
        writeScope: ["src/shared"],
        declared: [],
        flagGate: undefined,
      }),
    ).toThrow(/2 planned tasks gate differently/);
  });

  test("throws when there is nothing to resolve a gate from at all", () => {
    expect(() =>
      resolveClusterGate(bindings, {
        taskId: "repair-1",
        writeScope: ["src/nowhere"],
        declared: [],
        flagGate: undefined,
      }),
    ).toThrow(/has no revalidation gate/);
  });
});

describe("resolveClusterFindingRequirement", () => {
  const bindings: PlanBindings = {
    tasks: [{ id: "task-a", writeScope: ["src/a"], requirementIds: ["R-1"], gate: undefined }],
    requirementIds: new Set(["R-1", "R-2"]),
  };

  test("an explicit requirement id is accepted when it is a known requirement", () => {
    expect(resolveClusterFindingRequirement(bindings, "R-2", "finding-1", ["src/a"])).toBe("R-2");
  });

  test("an explicit requirement id that the run never recorded is refused", () => {
    expect(() =>
      resolveClusterFindingRequirement(bindings, "R-999", "finding-1", ["src/a"]),
    ).toThrow(/has not recorded/);
  });

  test("inherits the single requirement id of the one parent task writing this scope", () => {
    expect(resolveClusterFindingRequirement(bindings, undefined, "finding-1", ["src/a"])).toBe(
      "R-1",
    );
  });

  test("throws when no parent task covers the scope to inherit from", () => {
    expect(() =>
      resolveClusterFindingRequirement(bindings, undefined, "finding-1", ["src/nowhere"]),
    ).toThrow(/no planned task writing .* carries one to inherit/);
  });

  test("throws when more than one requirement id would be inherited", () => {
    const ambiguous: PlanBindings = {
      tasks: [
        { id: "task-a", writeScope: ["src/x"], requirementIds: ["R-1", "R-2"], gate: undefined },
      ],
      requirementIds: new Set(["R-1", "R-2"]),
    };
    expect(() =>
      resolveClusterFindingRequirement(ambiguous, undefined, "finding-1", ["src/x"]),
    ).toThrow(/carry 2 \(R-1, R-2\)/);
  });
});

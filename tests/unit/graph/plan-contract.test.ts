import { describe, expect, test } from "bun:test";
import {
  executionActive,
  gateContractActive,
  producedArtifacts,
  requirementContract,
  taskContract,
  taskGates,
} from "../../../orchestrating-long-tasks/scripts/src/graph/plan-contract.ts";

describe("requirementContract", () => {
  test("strips runtime fields from every requirement without mutating the source document", () => {
    const document = {
      requirements: [
        {
          id: "R-001",
          status: "satisfied",
          evidence: [{ kind: "test" }],
          authority_status: "granted",
          authority_history: [{ decision: "grant" }],
          instruction: "Do the thing",
        },
      ],
    };
    const contract = requirementContract(document);
    const stripped = (contract.requirements as Record<string, unknown>[])[0]!;
    expect(stripped).toEqual({ id: "R-001", instruction: "Do the thing" });
    // The source document is untouched — requirementContract must copy, never mutate in place.
    expect((document.requirements[0] as Record<string, unknown>).status).toBe("satisfied");
  });

  test("passes through a document with no requirements array unchanged", () => {
    const document = { schema: "harness.requirements" };
    expect(requirementContract(document)).toEqual({ schema: "harness.requirements" });
  });

  test("skips array entries masquerading as requirement records", () => {
    const document = { requirements: [["not", "a", "record"]] };
    expect(requirementContract(document)).toEqual({ requirements: [["not", "a", "record"]] });
  });
});

describe("producedArtifacts", () => {
  test("maps each task to the artifacts its produces edges name", () => {
    const graph = {
      nodes: [
        { id: "task-1", type: "task" },
        { id: "task-2", type: "task" },
        { id: "artifact-1", type: "artifact" },
      ],
      edges: [
        { source: "task-1", target: "artifact-1", type: "produces" },
        { source: "task-1", target: "artifact-1", type: "produces" },
        { source: "task-2", target: "artifact-1", type: "depends_on" },
      ],
    };
    const produced = producedArtifacts(graph);
    expect(produced.get("task-1")).toEqual(new Set(["artifact-1"]));
    // Present with no artifacts, not absent — task-2 exists as a task node even though it owns
    // nothing yet.
    expect(produced.get("task-2")).toEqual(new Set());
  });

  test("tolerates a graph with no nodes or edges arrays at all", () => {
    expect(producedArtifacts({})).toEqual(new Map());
  });
});

describe("taskGates", () => {
  test("returns only task-scoped gates that cover one of the task's requirements, sorted by id", () => {
    const graph = {
      gates: [
        { id: "gate-b", scope: "task", requirement_ids: ["R-001"] },
        { id: "gate-a", scope: "task", requirement_ids: ["R-001", "R-002"] },
        { id: "gate-run", scope: "run", requirement_ids: [] },
        { id: "gate-other", scope: "task", requirement_ids: ["R-999"] },
      ],
    };
    const gates = taskGates(graph, { id: "task-1", requirement_ids: ["R-001"] });
    expect(gates.map((g) => g.id)).toEqual(["gate-a", "gate-b"]);
  });

  test("a task with no requirement_ids array matches no gate", () => {
    const graph = {
      gates: [{ id: "gate-a", scope: "task", requirement_ids: ["R-001"] }],
    };
    expect(taskGates(graph, { id: "task-1" })).toEqual([]);
  });

  test("a graph with no gates array returns no gates", () => {
    expect(taskGates({}, { id: "task-1", requirement_ids: ["R-001"] })).toEqual([]);
  });
});

describe("taskContract", () => {
  test("drops runtime-only fields and injects computed dependencies and produces", () => {
    const task = {
      id: "task-1",
      status: "running",
      lease: { agent_id: "a1" },
      write_scope: ["src/a"],
    };
    const contract = taskContract(task, new Set(["task-0"]), new Set(["artifact-1"]));
    expect(contract).toEqual({
      id: "task-1",
      write_scope: ["src/a"],
      dependencies: ["task-0"],
      produces: ["artifact-1"],
    });
  });

  test("sorts dependencies and produces regardless of input Set iteration order", () => {
    const contract = taskContract(
      { id: "task-1" },
      new Set(["task-b", "task-a"]),
      new Set(["artifact-b", "artifact-a"]),
    );
    expect(contract.dependencies).toEqual(["task-a", "task-b"]);
    expect(contract.produces).toEqual(["artifact-a", "artifact-b"]);
  });
});

describe("executionActive", () => {
  test("is false for plannable statuses and true for every status past planning", () => {
    expect(executionActive("proposed")).toBe(false);
    expect(executionActive("ready")).toBe(false);
    expect(executionActive("running")).toBe(true);
    expect(executionActive("done")).toBe(true);
  });

  test("throws on a blank or non-string persisted status rather than guessing", () => {
    expect(() => executionActive("")).toThrow("persisted task status must be non-blank text");
    expect(() => executionActive("   ")).toThrow("persisted task status must be non-blank text");
    expect(() => executionActive(undefined)).toThrow(
      "persisted task status must be non-blank text",
    );
    expect(() => executionActive(42)).toThrow("persisted task status must be non-blank text");
  });
});

describe("gateContractActive", () => {
  test("is true for every in-flight status executionActive also calls active", () => {
    expect(gateContractActive("running")).toBe(true);
    expect(gateContractActive("validating")).toBe(true);
    expect(gateContractActive("changes_requested")).toBe(true);
  });

  test("is false for done, unlike executionActive — a finished task may still gain sibling gates", () => {
    // A done task's own gate results are already recorded; taskGates() selects by requirement
    // overlap, so a repair task inheriting the same requirement legitimately adds a new gate that
    // taskGates() then also attributes to the done task. gateContractActive exists precisely so
    // guardPlanRevision does not mistake that growth for a retroactive change.
    expect(executionActive("done")).toBe(true);
    expect(gateContractActive("done")).toBe(false);
  });

  test("is false for plannable statuses, same as executionActive", () => {
    expect(gateContractActive("proposed")).toBe(false);
    expect(gateContractActive("ready")).toBe(false);
  });

  test("throws on a blank or non-string persisted status, delegating to executionActive", () => {
    expect(() => gateContractActive("")).toThrow("persisted task status must be non-blank text");
    expect(() => gateContractActive(undefined)).toThrow(
      "persisted task status must be non-blank text",
    );
  });
});

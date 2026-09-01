import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  parseGateCommand,
  createImplementerValidatorPair,
  allocateTaskElements,
} from "../../../olt/scripts/src/graph/expansion/subtask-allocator.ts";
import { detectTransitiveBypasses } from "../../../olt/scripts/src/graph/expansion/bypass-detector.ts";
import { expandDeeper } from "../../../olt/scripts/src/graph/expansion/task-decomposition.ts";
import { expandWider } from "../../../olt/scripts/src/graph/expansion/wider-expansion.ts";
import { requirementsDocument } from "../../requirements/index.ts";
import { graphDocument } from "../validation/fixtures.ts";

describe("subtask-allocator: gate parsing and element allocation", () => {
  test("parseGateCommand handles various command strings, arrays, and empty tokens", () => {
    expect(parseGateCommand("   bun    test   src/foo.test.ts   ")).toEqual([
      "bun",
      "test",
      "src/foo.test.ts",
    ]);
    expect(parseGateCommand(["bun", "", "test", "  "])).toEqual(["bun", "test"]);
  });

  test("createImplementerValidatorPair creates implementer and validator with metadata", () => {
    const pair = createImplementerValidatorPair({
      taskId: "task-compiler",
      label: "AST Compiler",
      writeScope: ["src/compiler/index.ts"],
      gate: "bun test tests/compiler.test.ts",
      validatorGate: "bun test tests/compiler-val.test.ts",
      validatorScope: ["src/compiler/index.ts", "tests/compiler.test.ts"],
      priority: 75,
      effort: 5,
      requirementIds: ["req-ast-1"],
      status: "ready",
      createdOrder: 3,
    });

    expect(pair.implementerTask.id).toBe("task-compiler");
    expect(pair.implementerTask.paired_validator_id).toBe("val-compiler");
    expect(pair.implementerTask.status).toBe("ready");
    expect(pair.implementerTask.requirement_ids).toEqual(["req-ast-1"]);
    expect(pair.implementerTask.created_order).toBe(3);

    expect(pair.validatorTask.id).toBe("val-compiler");
    expect(pair.validatorTask.validates_task_id).toBe("task-compiler");
    expect(pair.validatorTask.role).toBe("validator");
    expect(pair.validatorTask.priority).toBe(76);
    expect(pair.validatorTask.effort).toBe(1);
    expect(pair.validatorTask.created_order).toBe(4);

    expect(pair.producesEdge.target).toBe("artifact-compiler");
    expect(pair.valProducesEdge.target).toBe("artifact-val-compiler");
    expect(pair.validationEdge.source).toBe("val-compiler");
    expect(pair.validationEdge.target).toBe("task-compiler");
    expect(pair.validationEdge.dataflow_justification).toContain("validates outputs");
    expect(pair.gateNode.id).toBe("gate-compiler");
    expect(pair.validatorGateNode?.id).toBe("gate-val-compiler");
  });

  test("allocateTaskElements constructs paired and standalone subtask graphs", () => {
    const paired = allocateTaskElements(
      {
        id: "task-sub-1",
        label: "Subtask 1",
        writeScope: ["src/feature/sub1.ts"],
        gate: "bun test tests/sub1.test.ts",
        deps: ["task-init"],
      },
      ["req-feat"],
      40,
      3,
      "sub_implementer",
      "proposed",
      true,
      1,
    );
    expect(paired.nodes).toHaveLength(4);
    expect(paired.edges).toHaveLength(3);
    expect(paired.gates).toHaveLength(1);
    expect(paired.pairedTask).toEqual({
      implementerTaskId: "task-sub-1",
      validatorTaskId: "val-sub-1",
    });
    expect(paired.nextOrder).toBe(2);

    const standalone = allocateTaskElements(
      {
        id: "task-sub-2",
        label: "Subtask 2",
        writeScope: ["src/feature/sub2.ts"],
        gate: "bun test tests/sub2.test.ts",
      },
      ["req-feat"],
      40,
      3,
      "sub_implementer",
      "ready",
      false,
      5,
    );
    expect(standalone.nodes).toHaveLength(2);
    expect(standalone.edges).toHaveLength(1);
    expect(standalone.pairedTask).toBeUndefined();
    expect(standalone.nextOrder).toBe(5);
  });
});

describe("subtask-allocator: bypass detector integration", () => {
  test("detects multi-hop transitive bypasses and provides remediation guidance", () => {
    const nodes: Record<string, unknown>[] = [
      { id: "task-root", type: "task" },
      { id: "task-mid-1", type: "task" },
      { id: "task-mid-2", type: "task" },
      { id: "task-leaf", type: "task" },
    ];
    const edges: Record<string, unknown>[] = [
      { source: "task-mid-1", target: "task-root", type: "depends_on" },
      { source: "task-mid-2", target: "task-mid-1", type: "depends_on" },
      { source: "task-leaf", target: "task-mid-2", type: "depends_on" },
      { source: "task-leaf", target: "task-root", type: "depends_on" },
    ];
    const check = detectTransitiveBypasses(nodes, edges);
    expect(check.hasBypass).toBe(true);
    expect(
      check.violations.some((v) => v.edge.source === "task-leaf" && v.edge.target === "task-root"),
    ).toBe(true);
    const violation = check.violations[0]!;
    expect(violation.code).toBe("TRANSITIVE_BYPASS_VIOLATION");
    expect(violation.guidance.remediationAction).toContain("Remove direct bypass edge");
    expect(check.warnings.length).toBeGreaterThan(0);
  });

  test("detects validator stage bypasses when intermediate is a validator", () => {
    const nodes: Record<string, unknown>[] = [
      { id: "task-1", type: "task" },
      { id: "val-1", type: "task", role: "validator" },
      { id: "task-2", type: "task" },
    ];
    const edges: Record<string, unknown>[] = [
      { source: "val-1", target: "task-1", type: "depends_on" },
      { source: "task-2", target: "val-1", type: "depends_on" },
      { source: "task-2", target: "task-1", type: "depends_on" },
    ];
    const check = detectTransitiveBypasses(nodes, edges);
    expect(check.hasBypass).toBe(true);
    const v = check.violations.find((item) => item.bypassedStage === "val-1");
    expect(v?.guidance.invariant).toBe("A3-gate-discrimination / Validator Bypass Invariant");
  });
});

describe("subtask-allocator: task decomposition bounds", () => {
  test("expandDeeper enforces scope boundaries for parent tasks with exact match and root scope", () => {
    const reqs = requirementsDocument("Root Task\n\nSub Task");
    const graph = graphDocument(reqs);

    const rootParentResult = expandDeeper(
      {
        ...graph,
        nodes: [
          ...(graph.nodes as Record<string, unknown>[]).filter((n) => n.id !== "task-1"),
          {
            id: "task-1",
            type: "task",
            label: "Root Scoped Task",
            write_scope: ["."],
            requirement_ids: ["req-1"],
            status: "ready",
          },
        ],
      },
      {
        parentTaskId: "task-1",
        subtasks: [
          {
            id: "task-1-anywhere",
            label: "Subtask in Any Dir",
            writeScope: ["any/nested/path/file.ts"],
            gate: "bun test",
          },
        ],
      },
    );
    expect(rootParentResult.success).toBe(true);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-1",
        subtasks: [
          {
            id: "task-1-leak",
            label: "Scope Leak",
            writeScope: ["src/area-2/file.ts"],
            gate: "bun test",
          },
        ],
      }),
    ).toThrow(HarnessError);
  });

  test("expandDeeper throws on non-existent parent task or empty subtasks", () => {
    const reqs = requirementsDocument("Task A");
    const graph = graphDocument(reqs);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-unknown",
        subtasks: [
          { id: "sub-1", label: "Sub 1", writeScope: ["src/area-1/sub.ts"], gate: "bun test" },
        ],
      }),
    ).toThrow(HarnessError);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-1",
        subtasks: [],
      }),
    ).toThrow(HarnessError);
  });

  test("expandWider enforces admission bounds and prevents duplicate task registration", () => {
    const reqs = requirementsDocument("Task Alpha");
    const graph = graphDocument(reqs);

    expect(() =>
      expandWider(graph, {
        newTasks: [],
      }),
    ).toThrow(HarnessError);

    expect(() =>
      expandWider(graph, {
        newTasks: [
          {
            id: "task-1",
            label: "Duplicate Task",
            writeScope: ["src/duplicate.ts"],
            gate: "bun test",
          },
        ],
      }),
    ).toThrow(HarnessError);

    const validWider = expandWider(graph, {
      admissionRationale: "Admit auxiliary telemetry task",
      autoPairValidators: true,
      newTasks: [
        {
          id: "task-metrics",
          label: "Metrics Ingest",
          writeScope: ["src/metrics.ts"],
          gate: "bun test tests/metrics.test.ts",
          deps: ["task-1"],
          depReasons: { "task-1": "Requires task-1 telemetry events" },
        },
      ],
    });
    expect(validWider.success).toBe(true);
    const addedEdge = validWider.addedEdges.find(
      (e) => e.source === "task-metrics" && e.type === "depends_on",
    );
    expect(addedEdge?.target).toBe("task-1");
    expect(addedEdge?.dataflow_justification).toBe("Requires task-1 telemetry events");
  });
});

import { describe, expect, test } from "bun:test";
import {
  createImplementerValidatorPair,
  detectTransitiveBypasses,
  expandDeeper,
  expandDynamicPlan,
  expandWider,
} from "../../../olt/scripts/src/graph/dynamic-expansion.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { graphDocument } from "./fixtures.ts";

describe("dynamic-expansion: createImplementerValidatorPair", () => {
  test("creates paired implementer, validator, artifact, edges, and gates", () => {
    const pair = createImplementerValidatorPair({
      taskId: "task-auth",
      label: "OAuth2 Provider Integration",
      writeScope: ["src/auth", "src/tokens.ts"],
      gate: "bun test tests/auth.test.ts",
      validatorGate: "bun test tests/auth-adversarial.test.ts",
      validatorScope: ["tests/probes/auth.ts"],
      priority: 80,
      effort: 5,
      requirementIds: ["req-auth"],
    });

    expect(pair.implementerTask.id).toBe("task-auth");
    expect(pair.implementerTask.role).toBe("implementer");
    expect(pair.implementerTask.paired_validator_id).toBe("val-auth");
    expect(pair.implementerTask.write_scope).toEqual(["src/auth", "src/tokens.ts"]);

    expect(pair.validatorTask.id).toBe("val-auth");
    expect(pair.validatorTask.role).toBe("validator");
    expect(pair.validatorTask.validates_task_id).toBe("task-auth");
    expect(pair.validatorTask.write_scope).toEqual(["tests/probes/auth.ts"]);

    expect(pair.artifactNode.id).toBe("artifact-auth");
    expect(pair.producesEdge).toEqual({
      source: "task-auth",
      target: "artifact-auth",
      type: "produces",
    });

    expect(pair.validationEdge.source).toBe("val-auth");
    expect(pair.validationEdge.target).toBe("task-auth");
    expect(pair.validationEdge.type).toBe("depends_on");

    expect(pair.gateNode.command).toEqual(["bun", "test", "tests/auth.test.ts"]);
    expect(pair.validatorGateNode?.command).toEqual([
      "bun",
      "test",
      "tests/auth-adversarial.test.ts",
    ]);
  });
});

describe("dynamic-expansion: detectTransitiveBypasses", () => {
  test("returns hasBypass=false for clean linear and diamond topologies", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "task-2", type: "task" },
      { id: "task-3", type: "task" },
    ];
    const edges = [
      { source: "task-2", target: "task-1", type: "depends_on" },
      { source: "task-3", target: "task-2", type: "depends_on" },
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  test("flags transitive shortcut bypass and generates structured cognitive guidance", () => {
    const nodes = [
      { id: "task-1", type: "task" },
      { id: "val-1", type: "task", role: "validator" },
      { id: "task-2", type: "task" },
    ];
    // task-2 depends on val-1 (which depends on task-1), but task-2 also adds a direct edge to task-1
    const edges = [
      { source: "val-1", target: "task-1", type: "depends_on" },
      { source: "task-2", target: "val-1", type: "depends_on" },
      { source: "task-2", target: "task-1", type: "depends_on" }, // Bypass shortcut!
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);

    const violation = result.violations[0]!;
    expect(violation.code).toBe("TRANSITIVE_BYPASS_VIOLATION");
    expect(violation.edge).toEqual({ source: "task-2", target: "task-1" });
    expect(violation.bypassedPath).toEqual(["task-2", "val-1", "task-1"]);
    expect(violation.bypassedStage).toBe("val-1");
    expect(violation.guidance.summary).toContain("bypasses intermediate stage val-1");
    expect(violation.guidance.remediationAction).toContain("Remove direct bypass edge");
    expect(violation.guidance.suggestedRemediationEdges).toEqual([
      { source: "task-2", target: "val-1", type: "depends_on" },
    ]);
  });

  test("flags paired validator bypass when downstream consumer skips paired validator", () => {
    const nodes = [
      { id: "task-impl", type: "task", role: "implementer", paired_validator_id: "val-impl" },
      { id: "val-impl", type: "task", role: "validator", validates_task_id: "task-impl" },
      { id: "task-consumer", type: "task", role: "implementer" },
    ];
    const edges = [
      { source: "val-impl", target: "task-impl", type: "depends_on" },
      { source: "task-consumer", target: "task-impl", type: "depends_on" }, // Directly on impl instead of val-impl!
    ];

    const result = detectTransitiveBypasses(nodes, edges);
    expect(result.hasBypass).toBe(true);
    const validatorBypass = result.violations.find((v) => v.bypassedStage === "val-impl");
    expect(validatorBypass).toBeDefined();
    expect(validatorBypass?.guidance.summary).toContain("bypasses paired validator val-impl");
    expect(validatorBypass?.guidance.remediationAction).toContain(
      "make task-consumer depend on val-impl",
    );
  });
});

describe("dynamic-expansion: expandDeeper", () => {
  test("decomposes parent task into sub-tasks with validator pairs and rewires dependencies", () => {
    const reqs = requirementsDocument("First\n\nSecond\n\nThird");
    const graph = graphDocument(reqs);

    // Parent task is task-2 (depends on task-1, has write_scope ["src/area-2"])
    const expansion = expandDeeper(graph, {
      parentTaskId: "task-2",
      decompositionRationale: "Task 2 is too complex, splitting into parser and tokenizer",
      autoPairValidators: true,
      subtasks: [
        {
          id: "task-2-parser",
          label: "Subtask Parser",
          writeScope: ["src/area-2/parser.ts"],
          gate: "bun test tests/parser.test.ts",
          deps: [],
        },
        {
          id: "task-2-tokenizer",
          label: "Subtask Tokenizer",
          writeScope: ["src/area-2/tokenizer.ts"],
          gate: "bun test tests/tokenizer.test.ts",
          deps: ["task-2-parser"],
        },
      ],
    });

    expect(expansion.success).toBe(true);
    expect(expansion.revision).toBe(2);

    const docNodes = expansion.graphDocument.nodes as Record<string, unknown>[];
    const parent = docNodes.find((n) => n.id === "task-2");
    expect(parent?.status).toBe("done");
    expect(parent?.decomposition_state).toBe("expanded_deeper");

    // Subtasks and validator pairs exist
    expect(docNodes.some((n) => n.id === "task-2-parser")).toBe(true);
    expect(docNodes.some((n) => n.id === "val-2-parser")).toBe(true);
    expect(docNodes.some((n) => n.id === "task-2-tokenizer")).toBe(true);
    expect(docNodes.some((n) => n.id === "val-2-tokenizer")).toBe(true);

    // Inherited upstream prereqs: task-2-parser inherits dependency on task-1
    const docEdges = expansion.graphDocument.edges as Record<string, unknown>[];
    const parserPrereqEdge = docEdges.find(
      (e) => e.source === "task-2-parser" && e.target === "task-1",
    );
    expect(parserPrereqEdge).toBeDefined();

    // Internal subtask dependency: task-2-tokenizer depends on val-2-parser
    const tokenizerSubEdge = docEdges.find(
      (e) => e.source === "task-2-tokenizer" && e.target === "val-2-parser",
    );
    expect(tokenizerSubEdge).toBeDefined();
  });

  test("refuses subtask write scope expansion beyond parent unless allowScopeGrowth=true", () => {
    const reqs = requirementsDocument("First\n\nSecond");
    const graph = graphDocument(reqs);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-1",
        subtasks: [
          {
            id: "task-1-leak",
            label: "Scope leaking subtask",
            writeScope: ["src/unrelated-other-dir"],
            gate: "bun test",
          },
        ],
      }),
    ).toThrow(HarnessError);

    // Passes when allowScopeGrowth is true
    const res = expandDeeper(
      graph,
      {
        parentTaskId: "task-1",
        subtasks: [
          {
            id: "task-1-leak",
            label: "Scope leaking subtask",
            writeScope: ["src/unrelated-other-dir"],
            gate: "bun test",
          },
        ],
      },
      { allowScopeGrowth: true },
    );
    expect(res.success).toBe(true);
  });
});

describe("dynamic-expansion: expandWider", () => {
  test("admits parallel tasks dynamically and pairs validators mid-flight", () => {
    const reqs = requirementsDocument("First\n\nSecond");
    const graph = graphDocument(reqs);

    const result = expandWider(graph, {
      admissionRationale: "Admitting parallel metrics collector task",
      autoPairValidators: true,
      newTasks: [
        {
          id: "task-metrics",
          label: "Telemetry & Metrics Collector",
          writeScope: ["src/telemetry"],
          gate: "bun test tests/telemetry.test.ts",
          deps: ["task-1"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.revision).toBe(2);

    const docNodes = result.graphDocument.nodes as Record<string, unknown>[];
    expect(docNodes.some((n) => n.id === "task-metrics")).toBe(true);
    expect(docNodes.some((n) => n.id === "val-metrics")).toBe(true);

    const docEdges = result.graphDocument.edges as Record<string, unknown>[];
    expect(docEdges.some((e) => e.source === "val-metrics" && e.target === "task-metrics")).toBe(
      true,
    );
  });

  test("rejects admitting duplicate task ID", () => {
    const reqs = requirementsDocument("First\n\nSecond");
    const graph = graphDocument(reqs);

    expect(() =>
      expandWider(graph, {
        newTasks: [
          {
            id: "task-1", // already exists
            label: "Colliding task",
            writeScope: ["src/col"],
            gate: "bun test",
          },
        ],
      }),
    ).toThrow(HarnessError);
  });
});

describe("dynamic-expansion: expandDynamicPlan unified", () => {
  test("applies both deeper and wider expansions in single atomic operation", () => {
    const reqs = requirementsDocument("First\n\nSecond\n\nThird");
    const graph = graphDocument(reqs);

    const result = expandDynamicPlan(
      graph,
      {
        deeper: [
          {
            parentTaskId: "task-2",
            subtasks: [
              {
                id: "task-2-sub1",
                label: "Sub 1",
                writeScope: ["src/area-2/part1.ts"],
                gate: "bun test tests/sub1.test.ts",
              },
            ],
          },
        ],
        wider: [
          {
            newTasks: [
              {
                id: "task-wide1",
                label: "Wide Task 1",
                writeScope: ["src/wide"],
                gate: "bun test tests/wide.test.ts",
                deps: ["task-1"],
              },
            ],
          },
        ],
      },
      reqs,
    );

    expect(result.success).toBe(true);
    expect(result.addedTasks.length).toBeGreaterThanOrEqual(4); // 2 implementers + 2 validators
    expect(result.pairedTasks.length).toBe(2);
  });
});

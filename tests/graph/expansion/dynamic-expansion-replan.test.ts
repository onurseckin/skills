import { describe, expect, test } from "bun:test";
import {
  expandDeeper,
  expandDynamicPlan,
  expandWider,
} from "../../../olt/scripts/src/graph/dynamic-expansion.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { requirementsDocument } from "../../requirements/fixtures.ts";
import { graphDocument } from "../validation/fixtures.ts";

describe("dynamic-expansion: expandDeeper", () => {
  test("decomposes parent task into sub-tasks with validator pairs and rewires dependencies", () => {
    const reqs = requirementsDocument("First\n\nSecond\n\nThird");
    const graph = graphDocument(reqs);

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

    expect(docNodes.some((n) => n.id === "task-2-parser")).toBe(true);
    expect(docNodes.some((n) => n.id === "val-2-parser")).toBe(true);
    expect(docNodes.some((n) => n.id === "task-2-tokenizer")).toBe(true);
    expect(docNodes.some((n) => n.id === "val-2-tokenizer")).toBe(true);

    const docEdges = expansion.graphDocument.edges as Record<string, unknown>[];
    const parserPrereqEdge = docEdges.find(
      (e) => e.source === "task-2-parser" && e.target === "task-1",
    );
    expect(parserPrereqEdge).toBeDefined();

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
            id: "task-1",
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
    expect(result.addedTasks.length).toBeGreaterThanOrEqual(4);
    expect(result.pairedTasks.length).toBe(2);
  });
});

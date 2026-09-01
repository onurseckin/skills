import { describe, expect, test } from "bun:test";
import {
  createImplementerValidatorPair,
  expandDeeper,
  expandDynamicPlan,
  expandWider,
} from "../../../olt/scripts/src/graph/dag-expansion.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { requirementsDocument } from "../../requirements/index.ts";
import { graphDocument } from "../validation/fixtures.ts";

describe("DAG Expansion: implementer validator pairing and decomposition", () => {
  describe("createImplementerValidatorPair", () => {
    test("creates paired implementer, validator, artifacts, edges, and gates", () => {
      const pair = createImplementerValidatorPair({
        taskId: "task-auth-engine",
        label: "OAuth2 Provider Engine",
        writeScope: ["src/auth/engine.ts", "src/auth/types.ts"],
        gate: "bun test tests/auth/engine.test.ts",
        validatorGate: "bun test tests/auth/adversarial.test.ts",
        validatorScope: ["tests/auth/probes.ts"],
        priority: 75,
        effort: 4,
        requirementIds: ["req-oauth2"],
      });

      expect(pair.implementerTask.id).toBe("task-auth-engine");
      expect(pair.implementerTask.role).toBe("implementer");
      expect(pair.implementerTask.paired_validator_id).toBe("val-auth-engine");
      expect(pair.implementerTask.write_scope).toEqual(["src/auth/engine.ts", "src/auth/types.ts"]);
      expect(pair.implementerTask.priority).toBe(75);
      expect(pair.implementerTask.effort).toBe(4);

      expect(pair.validatorTask.id).toBe("val-auth-engine");
      expect(pair.validatorTask.role).toBe("validator");
      expect(pair.validatorTask.validates_task_id).toBe("task-auth-engine");
      expect(pair.validatorTask.write_scope).toEqual(["tests/auth/probes.ts"]);

      expect(pair.artifactNode.id).toBe("artifact-auth-engine");
      expect(pair.valArtifactNode.id).toBe("artifact-val-auth-engine");

      expect(pair.producesEdge).toEqual({
        source: "task-auth-engine",
        target: "artifact-auth-engine",
        type: "produces",
      });

      expect(pair.valProducesEdge).toEqual({
        source: "val-auth-engine",
        target: "artifact-val-auth-engine",
        type: "produces",
      });

      expect(pair.validationEdge.source).toBe("val-auth-engine");
      expect(pair.validationEdge.target).toBe("task-auth-engine");
      expect(pair.validationEdge.type).toBe("depends_on");

      expect(pair.gateNode.command).toEqual(["bun", "test", "tests/auth/engine.test.ts"]);
      expect(pair.validatorGateNode?.command).toEqual([
        "bun",
        "test",
        "tests/auth/adversarial.test.ts",
      ]);
    });
  });

  describe("expandDeeper", () => {
    test("decomposes monolithic parent task into sub-tasks with paired validators and scope confinement", () => {
      const reqs = requirementsDocument("Alpha\n\nBeta\n\nGamma");
      const graph = graphDocument(reqs);

      const result = expandDeeper(graph, {
        parentTaskId: "task-2",
        decompositionRationale:
          "Task 2 is monolithic, decomposing into AST parser and code generator",
        autoPairValidators: true,
        subtasks: [
          {
            id: "task-2-ast",
            label: "Subtask AST Parser",
            writeScope: ["src/area-2/ast.ts"],
            gate: "bun test tests/ast.test.ts",
            deps: [],
          },
          {
            id: "task-2-codegen",
            label: "Subtask Code Generator",
            writeScope: ["src/area-2/codegen.ts"],
            gate: "bun test tests/codegen.test.ts",
            deps: ["task-2-ast"],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.revision).toBe(2);

      const nodes = result.graphDocument.nodes as Record<string, unknown>[];
      const parent = nodes.find((n) => n.id === "task-2");
      expect(parent?.status).toBe("done");
      expect(parent?.decomposition_state).toBe("expanded_deeper");

      expect(nodes.some((n) => n.id === "task-2-ast")).toBe(true);
      expect(nodes.some((n) => n.id === "val-2-ast")).toBe(true);
      expect(nodes.some((n) => n.id === "task-2-codegen")).toBe(true);
      expect(nodes.some((n) => n.id === "val-2-codegen")).toBe(true);

      const edges = result.graphDocument.edges as Record<string, unknown>[];
      expect(edges.some((e) => e.source === "task-2-ast" && e.target === "task-1")).toBe(true);
      expect(edges.some((e) => e.source === "task-2-codegen" && e.target === "val-2-ast")).toBe(
        true,
      );
    });

    test("enforces write scope confinement unless allowScopeGrowth is specified", () => {
      const reqs = requirementsDocument("First\n\nSecond");
      const graph = graphDocument(reqs);

      expect(() =>
        expandDeeper(graph, {
          parentTaskId: "task-1",
          subtasks: [
            {
              id: "task-1-leak",
              label: "Scope leaking subtask",
              writeScope: ["src/unrelated-leak/file.ts"],
              gate: "bun test",
            },
          ],
        }),
      ).toThrow(HarnessError);

      const allowed = expandDeeper(
        graph,
        {
          parentTaskId: "task-1",
          subtasks: [
            {
              id: "task-1-leak",
              label: "Scope leaking subtask",
              writeScope: ["src/unrelated-leak/file.ts"],
              gate: "bun test",
            },
          ],
        },
        { allowScopeGrowth: true },
      );
      expect(allowed.success).toBe(true);
    });
  });

  describe("expandWider", () => {
    test("dynamically admits parallel tasks mid-flight with validator pairing", () => {
      const reqs = requirementsDocument("Alpha\n\nBeta");
      const graph = graphDocument(reqs);

      const result = expandWider(graph, {
        admissionRationale: "Admitting parallel observability metrics task",
        autoPairValidators: true,
        newTasks: [
          {
            id: "task-observability",
            label: "Runtime Observability Exporter",
            writeScope: ["src/observability"],
            gate: "bun test tests/observability.test.ts",
            deps: ["task-1"],
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.revision).toBe(2);

      const nodes = result.graphDocument.nodes as Record<string, unknown>[];
      expect(nodes.some((n) => n.id === "task-observability")).toBe(true);
      expect(nodes.some((n) => n.id === "val-observability")).toBe(true);

      const edges = result.graphDocument.edges as Record<string, unknown>[];
      expect(
        edges.some((e) => e.source === "val-observability" && e.target === "task-observability"),
      ).toBe(true);
    });

    test("refuses duplicate task IDs during wider expansion", () => {
      const reqs = requirementsDocument("Alpha\n\nBeta");
      const graph = graphDocument(reqs);

      expect(() =>
        expandWider(graph, {
          newTasks: [
            {
              id: "task-1",
              label: "Duplicate task 1",
              writeScope: ["src/dup"],
              gate: "bun test",
            },
          ],
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("expandDynamicPlan atomic unified expansion", () => {
    test("executes both deeper and wider expansions in single atomic revision", () => {
      const reqs = requirementsDocument("Topic 1\n\nTopic 2\n\nTopic 3");
      const graph = graphDocument(reqs);

      const result = expandDynamicPlan(
        graph,
        {
          deeper: [
            {
              parentTaskId: "task-2",
              subtasks: [
                {
                  id: "task-2-sub",
                  label: "Decomposed Subtask",
                  writeScope: ["src/area-2/sub.ts"],
                  gate: "bun test tests/sub.test.ts",
                },
              ],
            },
          ],
          wider: [
            {
              newTasks: [
                {
                  id: "task-parallel-extra",
                  label: "Parallel Extra Task",
                  writeScope: ["src/extra"],
                  gate: "bun test tests/extra.test.ts",
                  deps: ["task-1"],
                },
              ],
            },
          ],
        },
        reqs,
      );

      expect(result.success).toBe(true);
      expect(result.pairedTasks.length).toBe(2);
      expect(result.addedTasks.length).toBeGreaterThanOrEqual(4);
    });
  });
});

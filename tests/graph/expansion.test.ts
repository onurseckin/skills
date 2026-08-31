import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  evaluateHierarchyScaling,
  formatParallelSubagentsDispatchArray,
  partitionWaveCoordinators,
  verifyAntiSerializationInterlock,
} from "../../olt/scripts/src/graph/parallel-decoupler.ts";
import {
  expandDeeper,
  expandDynamicPlan,
} from "../../olt/scripts/src/graph/dynamic-expansion.ts";
import {
  replanFromFindings,
  type ReplanFindingInput,
} from "../../olt/scripts/src/graph/dag-expansion.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { graphDocument } from "./fixtures.ts";

describe("task decomposition: expandDeeper", () => {
  test("decomposes parent task into ordered subtasks with scope containment and rewiring", () => {
    const reqs = requirementsDocument("Base\n\nIntermediate\n\nFinal");
    const graph = graphDocument(reqs);

    const result = expandDeeper(graph, {
      parentTaskId: "task-2",
      decompositionRationale: "Splitting task-2 into lexer, parser, and codegen subtasks",
      autoPairValidators: true,
      subtasks: [
        {
          id: "task-2-lexer",
          label: "Lexer Implementation",
          writeScope: ["src/area-2/lexer.ts"],
          gate: "bun test tests/lexer.test.ts",
          effort: 2,
          priority: 9,
          deps: [],
        },
        {
          id: "task-2-parser",
          label: "Parser Implementation",
          writeScope: ["src/area-2/parser.ts"],
          gate: "bun test tests/parser.test.ts",
          effort: 3,
          priority: 8,
          deps: ["task-2-lexer"],
        },
        {
          id: "task-2-codegen",
          label: "Codegen Implementation",
          writeScope: ["src/area-2/codegen.ts"],
          gate: "bun test tests/codegen.test.ts",
          effort: 4,
          priority: 7,
          deps: ["task-2-parser"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.revision).toBe(2);

    const nodes = result.graphDocument.nodes as Record<string, unknown>[];
    const parentNode = nodes.find((n) => n.id === "task-2");
    expect(parentNode?.status).toBe("done");
    expect(parentNode?.decomposition_state).toBe("expanded_deeper");

    expect(nodes.some((n) => n.id === "task-2-lexer")).toBe(true);
    expect(nodes.some((n) => n.id === "val-2-lexer")).toBe(true);
    expect(nodes.some((n) => n.id === "task-2-parser")).toBe(true);
    expect(nodes.some((n) => n.id === "val-2-parser")).toBe(true);
    expect(nodes.some((n) => n.id === "task-2-codegen")).toBe(true);
    expect(nodes.some((n) => n.id === "val-2-codegen")).toBe(true);

    const edges = result.graphDocument.edges as Record<string, unknown>[];
    expect(edges.some((e) => e.source === "task-2-lexer" && e.target === "task-1")).toBe(true);
    expect(edges.some((e) => e.source === "task-2-parser" && e.target === "val-2-lexer")).toBe(
      true,
    );
    expect(edges.some((e) => e.source === "task-2-codegen" && e.target === "val-2-parser")).toBe(
      true,
    );
  });

  test("enforces scope containment and rejects uncontained subtasks", () => {
    const reqs = requirementsDocument("Alpha\n\nBeta");
    const graph = graphDocument(reqs);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-1",
        subtasks: [
          {
            id: "task-1-sub-leak",
            label: "Leaking Subtask",
            writeScope: ["src/outside-area"],
            gate: "bun test",
          },
        ],
      }),
    ).toThrow(HarnessError);
  });

  test("rejects decomposition when parent task does not exist or subtask list is empty", () => {
    const reqs = requirementsDocument("Alpha");
    const graph = graphDocument(reqs);

    expect(() =>
      expandDeeper(graph, {
        parentTaskId: "task-missing",
        subtasks: [
          { id: "task-sub", label: "Subtask", writeScope: ["src/area-1/sub.ts"], gate: "bun test" },
        ],
      }),
    ).toThrow(HarnessError);

    expect(() => expandDeeper(graph, { parentTaskId: "task-1", subtasks: [] })).toThrow(
      HarnessError,
    );
  });
});

describe("subtask allocation: dynamic expansion & parallel lanes", () => {
  test("expandDynamicPlan performs deep and wide decomposition with lane allocation", () => {
    const reqs = requirementsDocument("Base\n\nNext");
    const graph = graphDocument(reqs);

    const plan = expandDynamicPlan(graph, {
      deeper: [
        {
          parentTaskId: "task-1",
          decompositionRationale: "Break task 1 down into two subtasks",
          autoPairValidators: true,
          subtasks: [
            { id: "task-1-a", label: "Part A", writeScope: ["src/area-1/a.ts"], gate: "bun test" },
            {
              id: "task-1-b",
              label: "Part B",
              writeScope: ["src/area-1/b.ts"],
              gate: "bun test",
              deps: ["task-1-a"],
            },
          ],
        },
      ],
      wider: [
        {
          admissionRationale: "Add metrics tracking task",
          autoPairValidators: true,
          newTasks: [
            {
              id: "task-telemetry",
              label: "Telemetry Task",
              writeScope: ["src/telemetry.ts"],
              gate: "bun test tests/telemetry.test.ts",
              deps: ["task-1-b"],
            },
          ],
        },
      ],
    });

    expect(plan.success).toBe(true);
    const nodes = plan.graphDocument.nodes as Record<string, unknown>[];
    expect(nodes.some((n) => n.id === "task-1-a")).toBe(true);
    expect(nodes.some((n) => n.id === "task-1-b")).toBe(true);
    expect(nodes.some((n) => n.id === "task-telemetry")).toBe(true);
    expect(nodes.some((n) => n.id === "val-telemetry")).toBe(true);
  });

  test("allocates subtasks across coordinator partitions and evaluates hierarchy scaling", () => {
    const subtasks = [
      { id: "subtask-ui-1", writeScope: ["src/ui/header.tsx"] },
      { id: "subtask-ui-2", writeScope: ["src/ui/footer.tsx"] },
      { id: "subtask-cli-1", writeScope: ["src/cli/command.ts"] },
      { id: "subtask-db-1", writeScope: ["src/db/schema.sql"] },
      { id: "subtask-core-1", writeScope: ["src/core/engine.ts"] },
      { id: "subtask-core-2", writeScope: ["src/core/parser.ts"] },
    ];

    const partitioned = partitionWaveCoordinators(subtasks, {
      maxLanesPerCoordinator: 3,
      stackPartitioning: true,
    });

    expect(partitioned.isMultiCoordinator).toBe(true);
    expect(partitioned.totalLanes).toBe(6);
    expect(partitioned.coordinatorCount).toBeGreaterThanOrEqual(2);

    const scaling = evaluateHierarchyScaling({
      taskCount: subtasks.length,
      maxLanesPerCoordinator: 3,
    });
    expect(scaling.path).toBe("multi_coordinator_expansion");
    expect(scaling.isMultiCoordinator).toBe(true);
    expect(scaling.requiredCoordinators).toBe(2);

    const fastScaling = evaluateHierarchyScaling({ taskCount: 1 });
    expect(fastScaling.path).toBe("fast_path_compaction");
    expect(fastScaling.fastPath).toBe(true);
    expect(fastScaling.requiredCoordinators).toBe(0);
  });

  test("formats subagent dispatch array and enforces anti-serialization interlock", () => {
    const allocatedSubtasks = [
      { id: "task-sub-1", label: "Subtask 1", zero_exploration_prompt: "Implement module 1" },
      { id: "task-sub-2", label: "Subtask 2", zero_exploration_prompt: "Implement module 2" },
    ];

    const dispatchArray = formatParallelSubagentsDispatchArray(allocatedSubtasks, {
      defaultTypeName: "worker",
      defaultWorkspace: "repo",
    });

    expect(dispatchArray).toHaveLength(2);
    expect(dispatchArray[0]?.TypeName).toBe("worker");
    expect(dispatchArray[0]?.Role).toContain("Subtask 1");
    expect(dispatchArray[0]?.Prompt).toBe("Implement module 1");
    expect(dispatchArray[1]?.Prompt).toBe("Implement module 2");

    const failedInterlock = verifyAntiSerializationInterlock(allocatedSubtasks, 1);
    expect(failedInterlock.passed).toBe(false);
    expect(failedInterlock.violation?.code).toBe("FALSE_SERIALIZATION_DEFECT");

    const passedInterlock = verifyAntiSerializationInterlock(allocatedSubtasks, 2);
    expect(passedInterlock.passed).toBe(true);
    expect(passedInterlock.violation).toBeUndefined();
  });

  test("replanFromFindings partitions defect findings into scoped repair subtasks with validators", () => {
    const reqs = requirementsDocument("Alpha\n\nBeta");
    const graph = graphDocument(reqs);

    const findings: readonly ReplanFindingInput[] = [
      {
        id: "defect-auth-1",
        severity: "critical",
        observation: "Missing auth validation",
        remediation: "Add token verification",
        filePaths: ["src/auth/token.ts"],
      },
      {
        id: "defect-auth-2",
        severity: "important",
        observation: "Token expiry unset",
        remediation: "Add TTL",
        filePaths: ["src/auth/token.ts"],
      },
      {
        id: "defect-ui-1",
        severity: "minor",
        observation: "Button alignment off",
        remediation: "Fix flex style",
        filePaths: ["src/ui/button.tsx"],
      },
    ];

    const replanResult = replanFromFindings({
      graphDocument: graph,
      findings,
      fallbackGate: "bun test tests/replan.test.ts",
      round: 2,
    });

    expect(replanResult.success).toBe(true);
    expect(replanResult.newRevision).toBe(2);
    expect(replanResult.addedRepairTasks).toHaveLength(2);
    expect(replanResult.pairedValidators).toHaveLength(2);
    expect(replanResult.partitionedScopes).toHaveLength(2);

    const repairAuth = replanResult.addedRepairTasks.find((t) =>
      (t.write_scope as string[]).includes("src/auth/token.ts"),
    );
    expect(repairAuth).toBeDefined();
    expect(repairAuth?.role).toBe("repairer");
  });
});

import { describe, expect, test } from "bun:test";
import {
  computeConcurrencyMetrics,
  computeDagCriticalPath,
  compileUnifiedPlan,
  createImplementerValidatorPair,
  detectCapsuleContext,
  detectTransitiveBypasses,
  expandDeeper,
  expandDynamicPlan,
  expandWider,
  formatDynamicDagAscii,
  reconstructDynamicDagState,
  replanFromFindings,
  type ReplanFindingInput,
} from "../../../orchestrating-long-tasks/scripts/src/graph/dag-expansion.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { graphDocument } from "./fixtures.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";

describe("DAG Expansion & High-Leverage Planning Engine", () => {
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

  describe("detectTransitiveBypasses", () => {
    test("approves clean linear DAG without bypass shortcuts", () => {
      const nodes = [
        { id: "task-a", type: "task" },
        { id: "task-b", type: "task" },
        { id: "task-c", type: "task" },
      ];
      const edges = [
        { source: "task-b", target: "task-a", type: "depends_on" },
        { source: "task-c", target: "task-b", type: "depends_on" },
      ];

      const result = detectTransitiveBypasses(nodes, edges);
      expect(result.hasBypass).toBe(false);
      expect(result.violations).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("detects transitive shortcut bypass and produces actionable cognitive guidance", () => {
      const nodes = [
        { id: "task-root", type: "task" },
        { id: "val-root", type: "task", role: "validator" },
        { id: "task-leaf", type: "task" },
      ];
      const edges = [
        { source: "val-root", target: "task-root", type: "depends_on" },
        { source: "task-leaf", target: "val-root", type: "depends_on" },
        { source: "task-leaf", target: "task-root", type: "depends_on" }, // Illegal shortcut bypass!
      ];

      const result = detectTransitiveBypasses(nodes, edges);
      expect(result.hasBypass).toBe(true);
      expect(result.violations.length).toBeGreaterThanOrEqual(1);

      const violation = result.violations[0]!;
      expect(violation.code).toBe("TRANSITIVE_BYPASS_VIOLATION");
      expect(violation.edge).toEqual({ source: "task-leaf", target: "task-root" });
      expect(violation.bypassedPath).toEqual(["task-leaf", "val-root", "task-root"]);
      expect(violation.bypassedStage).toBe("val-root");
      expect(violation.guidance.invariant).toContain("Validator Bypass Invariant");
      expect(violation.guidance.remediationAction).toContain("Remove direct bypass edge");
    });

    test("detects consumer skipping paired validator", () => {
      const nodes = [
        { id: "task-core", type: "task", role: "implementer", paired_validator_id: "val-core" },
        { id: "val-core", type: "task", role: "validator", validates_task_id: "task-core" },
        { id: "task-downstream", type: "task", role: "implementer" },
      ];
      const edges = [
        { source: "val-core", target: "task-core", type: "depends_on" },
        { source: "task-downstream", target: "task-core", type: "depends_on" }, // Skipped val-core!
      ];

      const result = detectTransitiveBypasses(nodes, edges);
      expect(result.hasBypass).toBe(true);
      const valBypass = result.violations.find((v) => v.bypassedStage === "val-core");
      expect(valBypass).toBeDefined();
      expect(valBypass?.guidance.summary).toContain("bypasses paired validator val-core");
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

  describe("compileUnifiedPlan", () => {
    test("compiles full high-leverage plan with audit, auto-decoupling, and wave topology", () => {
      const plan = compileUnifiedPlan({
        prompt: "Build Database Layer\n\nBuild HTTP Gateway\n\nBuild Cache Layer",
        completionGate: "bun test tests",
        autoDecouple: true,
        pairValidators: true,
        tasks: [
          {
            id: "task-db",
            label: "Database Layer",
            writeScope: ["src/db"],
            gate: "bun test tests/db.test.ts",
            requirementLines: [1],
            effort: 3,
          },
          {
            id: "task-http",
            label: "HTTP Gateway",
            writeScope: ["src/http"],
            gate: "bun test tests/http.test.ts",
            requirementLines: [3],
            effort: 2,
          },
          {
            id: "task-cache",
            label: "Cache Layer",
            writeScope: ["src/cache"],
            gate: "bun test tests/cache.test.ts",
            requirementLines: [5],
            effort: 2,
          },
        ],
      });

      expect(plan.graphDocument).toBeDefined();
      expect(plan.requirementsDocument).toBeDefined();
      expect(plan.audit).toBeDefined();
      expect(plan.topology.waves.length).toBeGreaterThanOrEqual(1);
      expect(plan.topology.metrics.parallelismFactor).toBeGreaterThanOrEqual(1);
      expect(plan.bypassDiagnostic.hasBypass).toBe(false);
    });
  });

  describe("detectCapsuleContext", () => {
    test("extracts context from in-memory objects", () => {
      const context = detectCapsuleContext({
        prompt: "Sample Capsule Prompt",
        repoRoot: "/tmp/fake-repo",
        runState: {
          run_id: "test-run-123",
          revision: 1,
        },
      });

      expect(context.prompt).toBe("Sample Capsule Prompt");
      expect(context.repoRoot).toBe("/tmp/fake-repo");
      expect(context.runState.run_id).toBe("test-run-123");
    });
  });

  describe("computeDagCriticalPath", () => {
    test("finds the longest weighted path through DAG", () => {
      const nodes = [
        { id: "task-init", type: "task", effort: 2 },
        { id: "task-branch-a", type: "task", effort: 5 },
        { id: "task-branch-b", type: "task", effort: 2 },
        { id: "task-finalize", type: "task", effort: 3 },
      ];
      const edges = [
        { source: "task-branch-a", target: "task-init", type: "depends_on" },
        { source: "task-branch-b", target: "task-init", type: "depends_on" },
        { source: "task-finalize", target: "task-branch-a", type: "depends_on" },
        { source: "task-finalize", target: "task-branch-b", type: "depends_on" },
      ];

      const cp = computeDagCriticalPath(nodes, edges);
      // Path: init (2) -> branch-a (5) -> finalize (3) = 10
      expect(cp.criticalPath).toEqual(["task-init", "task-branch-a", "task-finalize"]);
      expect(cp.totalEffort).toBe(10);
      expect(cp.longestChainLength).toBe(3);
    });
  });

  describe("computeConcurrencyMetrics", () => {
    test("computes accurate concurrency metrics", () => {
      const waves = [
        { waveIndex: 0, tasks: ["t1", "t2", "t3"] },
        { waveIndex: 1, tasks: ["t4", "t5"] },
        { waveIndex: 2, tasks: ["t6"] },
      ];

      const metrics = computeConcurrencyMetrics(waves);
      expect(metrics.maxParallelism).toBe(3);
      expect(metrics.totalTasks).toBe(6);
      expect(metrics.totalWaves).toBe(3);
      expect(metrics.averageWaveConcurrency).toBe(2);
      expect(metrics.theoreticalSpeedup).toBe(2);
    });
  });

  describe("reconstructDynamicDagState", () => {
    test("replays event log to reconstruct living DAG and active agents", () => {
      const events: JsonObject[] = [
        {
          kind: "plan-compiled",
          actor: "planner",
          payload: { revision: 1 },
          timestamp: "2026-08-22T21:00:00.000Z",
        },
        {
          kind: "plan-task-added",
          actor: "planner",
          payload: {
            task_id: "task-auth",
            label: "Auth Implementation",
            write_scope: ["src/auth.ts"],
          },
          timestamp: "2026-08-22T21:01:00.000Z",
        },
        {
          kind: "task-claimed",
          actor: "impl-worker-1",
          payload: {
            task_id: "task-auth",
            agent: "impl-worker-1",
            role: "implementer",
          },
          timestamp: "2026-08-22T21:02:00.000Z",
        },
        {
          kind: "task-submitted",
          actor: "impl-worker-1",
          payload: {
            task_id: "task-auth",
            agent: "impl-worker-1",
            summary: "Auth implemented",
          },
          timestamp: "2026-08-22T21:05:00.000Z",
        },
        {
          kind: "validate-start",
          actor: "val-agent-1",
          payload: {
            task_id: "task-auth",
            validator: "val-agent-1",
          },
          timestamp: "2026-08-22T21:06:00.000Z",
        },
        {
          kind: "task-reviewed",
          actor: "val-agent-1",
          payload: {
            task_id: "task-auth",
            status: "pass",
            summary: "All verification gates passed",
          },
          timestamp: "2026-08-22T21:08:00.000Z",
        },
        {
          kind: "branch-opened",
          actor: "impl-worker-2",
          payload: {
            parent_task_id: "task-auth",
            branch_id: "branch-sub-1",
            subtasks: [
              {
                id: "task-sub-jwt",
                label: "JWT Token Handler",
                write_scope: ["src/auth/jwt.ts"],
              },
            ],
          },
          timestamp: "2026-08-22T21:09:00.000Z",
        },
      ];

      const dagState = reconstructDynamicDagState(events);
      expect(dagState.revision).toBe(1);
      expect(dagState.totalEvents).toBe(7);
      expect(dagState.executionSummary.totalTasks).toBe(2);
      expect(dagState.executionSummary.doneTasks).toBe(1);
      expect(dagState.executionSummary.readyTasks).toBe(1);
      expect(dagState.executionSummary.totalBranches).toBe(1);

      const authTask = dagState.tasks.find((t) => t.id === "task-auth");
      expect(authTask).toBeDefined();
      expect(authTask?.status).toBe("done");
      expect(authTask?.assignedAgent).toBe("impl-worker-1");
      expect(authTask?.validatorId).toBe("val-agent-1");

      const jwtSubtask = dagState.tasks.find((t) => t.id === "task-sub-jwt");
      expect(jwtSubtask).toBeDefined();
      expect(jwtSubtask?.origin).toBe("branch");
      expect(jwtSubtask?.branchId).toBe("branch-sub-1");

      expect(dagState.activeAgents.some((a) => a.agentId === "impl-worker-1")).toBe(true);
      expect(dagState.activeAgents.some((a) => a.agentId === "val-agent-1")).toBe(true);
    });
  });

  describe("replanFromFindings", () => {
    test("partitions findings into parallel repair tasks with paired validators", () => {
      const reqs = requirementsDocument("Initial Prompt");
      const graph = graphDocument(reqs);

      const findings: ReplanFindingInput[] = [
        {
          id: "finding-mem-leak",
          severity: "critical",
          observation: "Memory leak in connection pool",
          remediation: "Close pooled sockets on timeout",
          filePaths: ["src/db/pool.ts"],
          revalidationGate: "bun test tests/db/pool.test.ts",
        },
        {
          id: "finding-sql-injection",
          severity: "critical",
          observation: "Unsanitized query in search endpoint",
          remediation: "Use parameterized queries",
          filePaths: ["src/db/query.ts"],
          revalidationGate: "bun test tests/db/query.test.ts",
        },
      ];

      const replan = replanFromFindings({
        graphDocument: graph,
        findings,
        fallbackGate: "bun test",
        round: 2,
      });

      expect(replan.success).toBe(true);
      expect(replan.newRevision).toBe(2);
      expect(replan.addedRepairTasks.length).toBe(2);
      expect(replan.pairedValidators.length).toBe(2);
      expect(replan.partitionedScopes.length).toBe(2);

      const repair1 = replan.addedRepairTasks[0]!;
      expect(repair1.role).toBe("repairer");
      expect(repair1.write_scope).toEqual(["src/db/pool.ts"]);

      const repair2 = replan.addedRepairTasks[1]!;
      expect(repair2.role).toBe("repairer");
      expect(repair2.write_scope).toEqual(["src/db/query.ts"]);
    });
  });

  describe("formatDynamicDagAscii", () => {
    test("formats ASCII overview of DynamicDagState", () => {
      const reqs = requirementsDocument("Initial");
      const graph = graphDocument(reqs);
      const output = formatDynamicDagAscii(graph);

      expect(output).toContain("=== Plan Graph DAG");
      expect(output).toContain("task-1");
    });
  });
});

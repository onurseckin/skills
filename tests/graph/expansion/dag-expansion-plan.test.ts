import { describe, expect, test } from "bun:test";
import {
  compileUnifiedHighLeveragePlan,
  computeConcurrencyMetrics,
  computeDagCriticalPath,
  detectCapsuleContext,
  formatDynamicDagAscii,
  reconstructDynamicDagState,
  replanFromFindings,
  type ReplanFindingInput,
} from "../../../olt/scripts/src/graph/dag-expansion.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { requirementsDocument } from "../../requirements/fixtures.ts";
import { graphDocument } from "../validation/fixtures.ts";

describe("DAG Expansion: planning, metrics, reconstruction, and replanning", () => {
  describe("compileUnifiedHighLeveragePlan", () => {
    test("compiles full high-leverage plan with audit, auto-decoupling, and wave topology", () => {
      const plan = compileUnifiedHighLeveragePlan({
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

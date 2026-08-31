import { describe, expect, test } from "bun:test";
import {
  auditGraphHealth,
  probeCircularDependencies,
  probeGateCoverageViolations,
  probeOrphanedTasks,
  probeScopeCollisionHazards,
  probeStaleLeases,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import { schedulerState } from "../fixtures.ts";

describe("Core Scheduler Engine — 5-Point Graph Health Probes", () => {
  describe("Probe 1: Orphaned Tasks", () => {
    test("passes on healthy graph where all tasks map to requirements and graph nodes", () => {
      const state = schedulerState();
      const result = probeOrphanedTasks(state);
      expect(result.passed).toBeTrue();
      expect(result.orphanedTaskIds).toHaveLength(0);
    });

    test("detects tasks with empty or unmapped requirement_ids", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["orphaned-1"] = {
        id: "orphaned-1",
        status: "ready",
        requirement_ids: [],
        write_scope: ["src/orphaned"],
      };

      const result = probeOrphanedTasks(state);
      expect(result.passed).toBeFalse();
      expect(result.orphanedTaskIds).toContain("orphaned-1");
      expect(result.unmappedRequirementTaskIds).toContain("orphaned-1");
    });

    test("detects tasks referencing non-existent requirements", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["bad-req-task"] = {
        id: "bad-req-task",
        status: "ready",
        requirement_ids: ["R-NONEXISTENT-999"],
        write_scope: ["src/bad"],
      };

      const result = probeOrphanedTasks(state);
      expect(result.passed).toBeFalse();
      expect(result.orphanedTaskIds).toContain("bad-req-task");
    });

    test("detects tasks present in state but disconnected/missing from graph nodes", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["disconnected-node"] = {
        id: "disconnected-node",
        status: "ready",
        requirement_ids: ["R-001"],
        write_scope: ["src/disconnected"],
      };

      const result = probeOrphanedTasks(state);
      expect(result.passed).toBeFalse();
      expect(result.disconnectedTaskIds).toContain("disconnected-node");
    });
  });

  describe("Probe 2: Stale Leases", () => {
    test("passes when all active tasks have valid unexpired leases", () => {
      const state = schedulerState();
      const now = new Date("2026-08-22T10:00:00.000Z");
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "running";
      tasks.priority!.lease = {
        agent_id: "worker-1",
        role: "implementer",
        attempt: 1,
        token_digest: "digest-1",
        issued_at: "2026-08-22T09:55:00.000Z",
        expires_at: "2026-08-22T10:15:00.000Z",
        heartbeat_at: "2026-08-22T09:59:00.000Z",
        duration_seconds: 1200,
      };

      const result = probeStaleLeases(state, { now });
      expect(result.passed).toBeTrue();
      expect(result.staleTaskIds).toHaveLength(0);
    });

    test("detects active tasks whose lease expiration timestamp has passed", () => {
      const state = schedulerState();
      const now = new Date("2026-08-22T10:30:00.000Z");
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "running";
      tasks.priority!.lease = {
        agent_id: "worker-1",
        role: "implementer",
        attempt: 1,
        token_digest: "digest-1",
        issued_at: "2026-08-22T09:50:00.000Z",
        expires_at: "2026-08-22T10:00:00.000Z",
        heartbeat_at: "2026-08-22T09:55:00.000Z",
        duration_seconds: 600,
      };

      const result = probeStaleLeases(state, { now });
      expect(result.passed).toBeFalse();
      expect(result.staleTaskIds).toContain("priority");
      expect(result.staleLeases[0]!.reason).toBe("expired_timestamp");
      expect(result.staleLeases[0]!.overdueMs).toBeGreaterThan(0);
    });

    test("detects active tasks whose heartbeat is overdue past threshold", () => {
      const state = schedulerState();
      const now = new Date("2026-08-22T10:30:00.000Z");
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "validating";
      tasks.priority!.lease = {
        agent_id: "val-1",
        role: "validator",
        attempt: 1,
        token_digest: "digest-val",
        issued_at: "2026-08-22T10:00:00.000Z",
        expires_at: "2026-08-22T11:00:00.000Z",
        heartbeat_at: "2026-08-22T10:05:00.000Z",
        duration_seconds: 3600,
      };

      const result = probeStaleLeases(state, { now, timeoutMs: 360_000 });
      expect(result.passed).toBeFalse();
      expect(result.staleTaskIds).toContain("priority");
      expect(result.staleLeases[0]!.reason).toBe("heartbeat_timeout");
    });
  });

  describe("Probe 3: Circular Dependencies", () => {
    test("passes on an acyclic DAG", () => {
      const state = schedulerState();
      const result = probeCircularDependencies(state);
      expect(result.passed).toBeTrue();
      expect(result.hasCycles).toBeFalse();
    });

    test("detects 2-node cycle in graph edges", () => {
      const state = schedulerState();
      const graph = state.graph as Record<string, unknown>;
      const edges = graph.edges as Record<string, string>[];
      edges.push({ source: "deep", target: "deep-child", type: "depends_on" });

      const result = probeCircularDependencies(state);
      expect(result.passed).toBeFalse();
      expect(result.hasCycles).toBeTrue();
      expect(result.cycleDescriptions.length).toBeGreaterThan(0);
    });

    test("detects self-dependency cycle", () => {
      const state = schedulerState();
      const graph = state.graph as Record<string, unknown>;
      const edges = graph.edges as Record<string, string>[];
      edges.push({ source: "priority", target: "priority", type: "depends_on" });

      const result = probeCircularDependencies(state);
      expect(result.passed).toBeFalse();
      expect(result.hasCycles).toBeTrue();
    });
  });

  describe("Probe 4: Gate Coverage Violations", () => {
    test("passes when all task requirements are covered by mandatory gates", () => {
      const state = schedulerState();
      const result = probeGateCoverageViolations(state);
      expect(result.passed).toBeTrue();
      expect(result.uncoveredRequirementIds).toHaveLength(0);
      expect(result.hasMandatoryRunGate).toBeTrue();
    });

    test("detects tasks with uncovered requirements when no task gate or run gate covers it", () => {
      const state = schedulerState();
      const graph = state.graph as Record<string, unknown>;
      graph.gates = [];

      const result = probeGateCoverageViolations(state);
      expect(result.passed).toBeFalse();
      expect(result.uncoveredRequirementIds).toContain("R-001");
      expect(result.tasksWithoutGateCoverage.length).toBeGreaterThan(0);
    });

    test("detects invalid gate configurations (weak command, invalid scope, missing reqs)", () => {
      const state = schedulerState();
      const graph = state.graph as Record<string, unknown>;
      graph.gates = [
        { id: "bad-gate-1", command: "true", cwd: ".", scope: "task", requirement_ids: [] },
        {
          id: "bad-gate-2",
          command: "bun test",
          cwd: "/abs/path",
          scope: "invalid-scope",
          requirement_ids: ["R-001"],
        },
      ];

      const result = probeGateCoverageViolations(state);
      expect(result.passed).toBeFalse();
      expect(result.invalidGates.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Probe 5: Scope Collision Hazards", () => {
    test("passes when active tasks have disjoint write scopes and resource scopes", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "running";
      tasks.priority!.write_scope = ["src/priority"];
      tasks.deep!.status = "running";
      tasks.deep!.write_scope = ["src/deep"];

      const result = probeScopeCollisionHazards(state);
      expect(result.passed).toBeTrue();
      expect(result.activeCollisions).toHaveLength(0);
    });

    test("detects active concurrent collision when two running tasks have overlapping write scopes", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "running";
      tasks.priority!.write_scope = ["src/common/module"];
      tasks.deep!.status = "running";
      tasks.deep!.write_scope = ["src/common/**"];

      const result = probeScopeCollisionHazards(state);
      expect(result.passed).toBeFalse();
      expect(result.activeCollisions.length).toBe(1);
      expect(result.activeCollisions[0]!.writeScopeOverlap).toBeTrue();
      expect(result.activeCollisions[0]!.conflictType).toBe("write_scope");
    });

    test("detects candidate collision between eligible tasks with shared resource scopes", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks.priority!.status = "ready";
      tasks.priority!.resource_scope = ["port:8080"];
      tasks.deep!.status = "ready";
      tasks.deep!.resource_scope = ["port:8080"];

      const result = probeScopeCollisionHazards(state);
      expect(result.passed).toBeTrue();
      expect(result.candidateCollisions.length).toBe(1);
      expect(result.candidateCollisions[0]!.resourceScopeOverlap).toBeTrue();
    });
  });

  describe("Full Graph Health Audit", () => {
    test("healthy audit report returns healthy true with zero critical issues", () => {
      const state = schedulerState();
      const report = auditGraphHealth(state);
      expect(report.healthy).toBeTrue();
      expect(report.totalTasks).toBeGreaterThan(0);
      expect(report.issues).toHaveLength(0);
    });

    test("unhealthy state aggregates issues across probes", () => {
      const state = schedulerState();
      const tasks = state.tasks as Record<string, Record<string, unknown>>;
      tasks["orphan"] = { id: "orphan", status: "ready", requirement_ids: [], write_scope: [] };

      const report = auditGraphHealth(state);
      expect(report.healthy).toBeFalse();
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.issues.some((i) => i.probe === "orphaned_tasks")).toBeTrue();
    });
  });
});

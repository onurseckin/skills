import { describe, expect, test } from "bun:test";
import {
  assertDoctorGatePassed,
  auditDoctorGate,
  auditGraphHealth,
  auditSupervisory5PointHealth,
  auditSupervisoryWatchdog,
  determineTopLeader,
  dispatchSupervisoryHealthProbe,
  executePulseTick,
  probeAgentRegistryAccuracy,
  probeCircularDependencies,
  probeDoctorErrorResolution,
  probeGateCoverageViolations,
  probeOrphanedTasks,
  probePlanEnhancementNeeds,
  probeRoleBoundaryAdherence,
  probeScopeCollisionHazards,
  probeStaleLeases,
  probeWorkSpanParallelizationHealth,
  recoverStaleTasks,
  runPulseLoop,
  SchedulerEngine,
} from "../../../orchestrating-long-tasks/scripts/src/scheduler/index.ts";
import { registerWatchdog } from "../../../orchestrating-long-tasks/scripts/src/authority/watchdog-manager.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type {
  TaskRecord,
  TransactionPort,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { schedulerState } from "./fixtures.ts";

function createMockPort(initialState: Record<string, unknown>): TransactionPort {
  let state = structuredClone(initialState) as unknown as WorkflowState;
  return {
    read: () => structuredClone(state),
    transact: (actor, kind, payload, mutate) => {
      const draft = structuredClone(state);
      mutate(draft);
      state = draft;
      return state;
    },
  };
}

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
        expires_at: "2026-08-22T10:00:00.000Z", // Expired 30 mins ago
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
        expires_at: "2026-08-22T11:00:00.000Z", // Future expires_at
        heartbeat_at: "2026-08-22T10:05:00.000Z", // Heartbeat 25 mins ago (> 6 min timeout)
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
      edges.push(
        { source: "deep", target: "deep-child", type: "depends_on" }, // Creates deep <-> deep-child cycle
      );

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
      graph.gates = []; // Remove all gates

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
      expect(result.passed).toBeTrue(); // Active collisions is 0
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

describe("Core Scheduler Engine — Structured 5-Point Supervisory Health Audit (p24)", () => {
  test("Probe (a): Work/Span parallelization health evaluates metrics", () => {
    const state = schedulerState();
    const result = probeWorkSpanParallelizationHealth(state);
    expect(result.passed).toBeTrue();
    expect(result.workParallelismRatio).toBeGreaterThan(0);
    expect(result.details.length).toBeGreaterThan(0);
  });

  test("Probe (b): Plan enhancement needs detects unfulfilled requirements", () => {
    const state = schedulerState();
    const stateReqs = state.requirements as Record<string, unknown>;
    stateReqs.requirements = [
      { id: "R-001", status: "open" },
      { id: "R-UNFULFILLED-999", status: "open" },
    ];

    const result = probePlanEnhancementNeeds(state);
    expect(result.passed).toBeFalse();
    expect(result.unfulfilledRequirementsCount).toBe(1);
    expect(result.suggestedEnhancements).toContain(
      "Requirement 'R-UNFULFILLED-999' has no assigned tasks.",
    );
  });

  test("Probe (c): 100% Agent Registry Accuracy detects ghost agents and role mismatches", () => {
    const state = schedulerState();
    state.agents = [
      {
        id: "worker-1",
        role: "implementer",
        status: "active",
        host: "local",
        granted_at: "2026-08-22T00:00:00Z",
        parent_agent_id: null,
        parent_task_id: null,
      },
    ];

    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.lease = {
      agent_id: "ghost-worker-99", // Unregistered ghost agent
      role: "implementer",
      issued_at: "2026-08-22T00:00:00Z",
      expires_at: "2026-08-22T01:00:00Z",
      heartbeat_at: "2026-08-22T00:05:00Z",
      duration_seconds: 3600,
    };

    const result = probeAgentRegistryAccuracy(state);
    expect(result.passed).toBeFalse();
    expect(result.ghostAgentIds).toContain("ghost-worker-99");
    expect(result.accuracyPercentage).toBeLessThan(100);
  });

  test("Probe (c): 100% Agent Registry Accuracy passes on 100% compliant active registry", () => {
    const state = schedulerState();
    state.agents = [
      {
        id: "worker-1",
        role: "implementer",
        status: "active",
        host: "local",
        granted_at: "2026-08-22T00:00:00Z",
        parent_agent_id: null,
        parent_task_id: null,
      },
    ];

    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.lease = {
      agent_id: "worker-1",
      role: "implementer",
      issued_at: "2026-08-22T00:00:00Z",
      expires_at: "2026-08-22T01:00:00Z",
      heartbeat_at: "2026-08-22T00:05:00Z",
      duration_seconds: 3600,
    };

    const result = probeAgentRegistryAccuracy(state);
    expect(result.passed).toBeTrue();
    expect(result.accuracyPercentage).toBe(100);
    expect(result.ghostAgentIds).toHaveLength(0);
  });

  test("Probe (d): Role boundary adherence detects non-validator holding validating lease", () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "validating";
    tasks.priority!.lease = {
      agent_id: "implementer-1",
      role: "implementer", // Illegal: implementer cannot hold validating lease
      issued_at: "2026-08-22T00:00:00Z",
      expires_at: "2026-08-22T01:00:00Z",
      heartbeat_at: "2026-08-22T00:05:00Z",
      duration_seconds: 3600,
    };

    const result = probeRoleBoundaryAdherence(state);
    expect(result.passed).toBeFalse();
    expect(result.hierarchicalViolations.length).toBeGreaterThan(0);
  });

  test("determineTopLeader identifies Mind Lead first, then Orchestrator Lead, then Coordinator", () => {
    const stateWithMind = {
      agents: [
        { id: "mind-0", role: "mind", status: "active" },
        { id: "orch-1", role: "orchestrator", status: "active" },
      ],
    };
    expect(determineTopLeader(stateWithMind).role).toBe("mind");
    expect(determineTopLeader(stateWithMind).agentId).toBe("mind-0");

    const stateWithOrch = {
      agents: [
        { id: "orch-1", role: "orchestrator", status: "active" },
        { id: "coord-1", role: "coordinator", status: "active" },
      ],
    };
    expect(determineTopLeader(stateWithOrch).role).toBe("orchestrator");
    expect(determineTopLeader(stateWithOrch).agentId).toBe("orch-1");

    const stateWithCoord = {
      agents: [{ id: "coord-1", role: "coordinator", status: "active" }],
    };
    expect(determineTopLeader(stateWithCoord).role).toBe("coordinator");
  });

  test("auditSupervisory5PointHealth and dispatchSupervisoryHealthProbe produce structured report", () => {
    const state = schedulerState();
    state.agents = [
      {
        id: "mind-lead",
        role: "mind",
        status: "active",
        host: "local",
        granted_at: "2026-08-22T00:00:00Z",
        parent_agent_id: null,
        parent_task_id: null,
      },
    ];

    const report = auditSupervisory5PointHealth(state);
    expect(report.topLeader.role).toBe("mind");
    expect(report.topLeader.agentId).toBe("mind-lead");
    expect(report.markdown).toContain("Two-Way Supervisory Watchdog 5-Point Health Probe");

    const dispatch = dispatchSupervisoryHealthProbe(state);
    expect(dispatch.dispatched).toBeTrue();
    expect(dispatch.targetAgentId).toBe("mind-lead");
    expect(dispatch.targetRole).toBe("mind");
    expect(dispatch.promptForLeader).toContain("[SUPERVISORY WATCHDOG PROBE]");
  });
});

describe("Core Scheduler Engine — Zero-Tolerance Doctor Gate Enforcement (p25)", () => {
  test("assertDoctorGatePassed throws HarnessError on failing doctor check", async () => {
    // Calling with non-existent / invalid directory triggers rejection
    await expect(assertDoctorGatePassed("/nonexistent/run/directory")).rejects.toThrow(
      HarnessError,
    );
  });
});

describe("Core Scheduler Engine — 2-Way Supervisory Watchdog & Recovery", () => {
  test("auditSupervisoryWatchdog detects active watchdogs and overdue heartbeats", () => {
    const now = new Date("2026-08-22T10:30:00.000Z");
    const report = auditSupervisoryWatchdog(undefined, { now });
    expect(report).toBeDefined();
    expect(report.checkedAt).toBe(now.toISOString());
  });

  test("recoverStaleTasks transitions expired running task to retry_ready with replacement evidence", () => {
    const state = schedulerState();
    const now = new Date("2026-08-22T11:00:00.000Z");
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.repair_round = 0;
    tasks.priority!.lease = {
      agent_id: "hung-worker-1",
      role: "implementer",
      attempt: 1,
      token_digest: "tok-1",
      issued_at: "2026-08-22T09:00:00.000Z",
      expires_at: "2026-08-22T09:30:00.000Z",
      heartbeat_at: "2026-08-22T09:10:00.000Z",
      duration_seconds: 1800,
    };

    const port = createMockPort(state);
    const recovery = recoverStaleTasks(port, { now, maxRepairRounds: 3 });

    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recoveredTasks[0]!.taskId).toBe("priority");
    expect(recovery.recoveredTasks[0]!.fromStatus).toBe("running");
    expect(recovery.recoveredTasks[0]!.toStatus).toBe("retry_ready");

    const updatedState = port.read();
    const recoveredTask = updatedState.tasks["priority"]!;
    expect(recoveredTask.status).toBe("retry_ready");
    expect(recoveredTask.replacement_reason).toBe("stale");
    expect(recoveredTask.lease).toBeUndefined();
  });

  test("recoverStaleTasks marks task stale when max repair rounds exhausted", () => {
    const state = schedulerState();
    const now = new Date("2026-08-22T11:00:00.000Z");
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks.priority!.status = "running";
    tasks.priority!.repair_round = 3; // Maxed out
    tasks.priority!.lease = {
      agent_id: "crashed-worker",
      role: "implementer",
      attempt: 3,
      token_digest: "tok-3",
      issued_at: "2026-08-22T09:00:00.000Z",
      expires_at: "2026-08-22T09:30:00.000Z",
      heartbeat_at: "2026-08-22T09:10:00.000Z",
      duration_seconds: 1800,
    };

    const port = createMockPort(state);
    const recovery = recoverStaleTasks(port, { now, maxRepairRounds: 3 });

    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recoveredTasks[0]!.toStatus).toBe("stale");

    const updatedState = port.read();
    expect(updatedState.tasks["priority"]!.status).toBe("stale");
  });
});

describe("Core Scheduler Engine — Pulse Loop Execution", () => {
  test("executePulseTick performs single-step audit, recovery, and wave evaluation", () => {
    const state = schedulerState();
    const port = createMockPort(state);

    const tickResult = executePulseTick(port, { tickNumber: 1 });
    expect(tickResult.tickNumber).toBe(1);
    expect(tickResult.graphHealthy).toBeTrue();
    expect(tickResult.supervisoryReport).toBeDefined();
    expect(tickResult.readyTasks.length).toBeGreaterThan(0);
    expect(tickResult.workflowCompleted).toBeFalse();
  });

  test("runPulseLoop executes multi-tick loop up to maxTicks", async () => {
    const state = schedulerState();
    const port = createMockPort(state);

    const ticksRecorded: number[] = [];
    const loopResult = await runPulseLoop(port, {
      maxTicks: 3,
      intervalMs: 10,
      onTick: (res) => ticksRecorded.push(res.tickNumber),
    });

    expect(loopResult.totalTicks).toBe(3);
    expect(loopResult.stoppedReason).toBe("max_ticks_reached");
    expect(ticksRecorded).toEqual([1, 2, 3]);
  });

  test("runPulseLoop halts when workflow is completed (all tasks done)", async () => {
    const state = schedulerState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    for (const t of Object.values(tasks)) {
      t.status = "done";
    }

    const port = createMockPort(state);
    const loopResult = await runPulseLoop(port, {
      maxTicks: 10,
      intervalMs: 10,
      stopWhenDone: true,
    });

    expect(loopResult.totalTicks).toBe(1);
    expect(loopResult.stoppedReason).toBe("workflow_completed");
  });

  test("runPulseLoop respects AbortSignal cancellation", async () => {
    const state = schedulerState();
    const port = createMockPort(state);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const loopResult = await runPulseLoop(port, {
      maxTicks: 100,
      intervalMs: 10,
      signal: controller.signal,
    });

    expect(loopResult.stoppedReason).toBe("aborted");
    expect(loopResult.totalTicks).toBeLessThan(100);
  });
});

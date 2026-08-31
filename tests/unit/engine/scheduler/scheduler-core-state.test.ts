import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  auditGraphHealth,
  auditSupervisoryWatchdog,
  recoverStaleTasks,
} from "../../../../olt/scripts/src/engine/scheduler/core/state.ts";
import type {
  TransactionPort,
  CapsuleStoreState,
} from "../../../../olt/scripts/src/workflow/types.ts";

describe("engine/scheduler/core/state.ts", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "state-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("auditGraphHealth", () => {
    it("reports healthy graph when all probes pass", () => {
      const state = {
        schema: "harness.run-state",
        version: 1,
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: [{ id: "t1" }],
          edges: [],
          gates: [
            {
              id: "gate-1",
              scope: "run",
              command: "bun test tests/unit/a.test.ts",
              mandatory: true,
            },
          ],
        },
        requirements: [{ id: "req-1" }],
        tasks: {
          t1: {
            id: "t1",
            status: "ready",
            requirement_ids: ["req-1"],
            write_scope: ["src/a.ts"],
            resource_scope: [],
          },
        },
      };

      const report = auditGraphHealth(state, { now: "2026-08-25T10:00:00.000Z" });
      expect(report.healthy).toBe(true);
      expect(report.totalTasks).toBe(1);
      expect(report.issues).toEqual([]);
      expect(report.checkedAt).toBe("2026-08-25T10:00:00.000Z");
      expect(report.probes.orphanedTasks.passed).toBe(true);
      expect(report.probes.staleLeases.passed).toBe(true);
      expect(report.probes.circularDependencies.passed).toBe(true);
      expect(report.probes.gateCoverageViolations.passed).toBe(true);
      expect(report.probes.scopeCollisionHazards.passed).toBe(true);
    });

    it("aggregates issues from multiple failing probes", () => {
      const state = {
        schema: "harness.run-state",
        version: 1,
        tasks: {
          t1: {
            id: "t1",
            status: "running",
            requirement_ids: ["req-uncovered"],
            write_scope: ["src/shared.ts"],
            resource_scope: [],
            dependencies: ["t1"], // circular self-dependency
            lease: {
              agent_id: "agent-stale",
              role: "implementer",
              expires_at: "2026-08-25T08:00:00.000Z", // stale
            },
          },
          t2: {
            id: "t2",
            status: "running", // colliding with t1 on write scope
            requirement_ids: [], // triggers orphaned_tasks probe
            write_scope: ["src/shared.ts"],
            resource_scope: [],
            dependencies: ["non_existent_orphan_parent"], // orphaned task parent
            lease: {
              agent_id: "agent-active",
              role: "implementer",
              expires_at: "2026-08-25T12:00:00.000Z",
            },
          },
        },
        requirements: [{ id: "req-uncovered" }],
        gates: [], // missing gate coverage
      };

      const report = auditGraphHealth(state, {
        now: "2026-08-25T10:00:00.000Z",
        timeoutMs: 60_000,
      });

      expect(report.healthy).toBe(false);
      expect(report.totalTasks).toBe(2);
      expect(report.issues.length).toBeGreaterThan(0);

      const probeTypes = report.issues.map((i) => i.probe);
      expect(probeTypes).toContain("stale_leases");
      expect(probeTypes).toContain("scope_collisions");
      expect(probeTypes).toContain("gate_coverage");
      expect(probeTypes).toContain("circular_dependencies");
      expect(probeTypes).toContain("orphaned_tasks");
    });
  });

  describe("auditSupervisoryWatchdog", () => {
    it("reports healthy watchdog state when no watchdogs are overdue", () => {
      const watchdogStore = {
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: "2026-08-25T10:00:00.000Z",
        watchdogs: [
          {
            id: "wd-1",
            generation: 1,
            pulse_id: null,
            phase: "executing",
            run_id: null,
            run_root: null,
            pid: 12345,
            ppid: 1234,
            agent_id: "agent-1",
            started_at: "2026-08-25T10:00:00.000Z",
            last_heartbeat_at: "2026-08-25T10:00:00.000Z",
            heartbeat_cadence_ms: 10_000,
            timeout_ms: 60_000,
            status: "active",
            terminated_at: null,
            termination_reason: null,
          },
          {
            id: "wd-2",
            generation: 1,
            pulse_id: null,
            phase: "executing",
            run_id: null,
            run_root: null,
            pid: 12346,
            ppid: 1234,
            agent_id: null,
            started_at: "2026-08-25T09:00:00.000Z",
            last_heartbeat_at: "2026-08-25T09:00:00.000Z",
            heartbeat_cadence_ms: 10_000,
            timeout_ms: 60_000,
            status: "terminated",
            terminated_at: "2026-08-25T09:05:00.000Z",
            termination_reason: "clean_exit",
          },
          {
            id: "wd-3",
            generation: 1,
            pulse_id: null,
            phase: "executing",
            run_id: null,
            run_root: null,
            pid: 12347,
            ppid: 1234,
            agent_id: null,
            started_at: "2026-08-25T09:00:00.000Z",
            last_heartbeat_at: "2026-08-25T09:00:00.000Z",
            heartbeat_cadence_ms: 10_000,
            timeout_ms: 60_000,
            status: "stale",
            terminated_at: null,
            termination_reason: null,
          },
          {
            id: "wd-4",
            generation: 1,
            pulse_id: null,
            phase: "executing",
            run_id: null,
            run_root: null,
            pid: 12348,
            ppid: 1234,
            agent_id: null,
            started_at: "2026-08-25T09:00:00.000Z",
            last_heartbeat_at: "2026-08-25T09:00:00.000Z",
            heartbeat_cadence_ms: 10_000,
            timeout_ms: 60_000,
            status: "orphaned",
            terminated_at: null,
            termination_reason: null,
          },
        ],
      };

      const storePath = join(tempDir, "watchdogs.json");
      writeFileSync(storePath, JSON.stringify(watchdogStore, null, 2));

      const report = auditSupervisoryWatchdog(storePath, {
        now: "2026-08-25T10:00:30.000Z", // 30s later, within 60s timeout
      });

      expect(report.healthy).toBe(true);
      expect(report.activeWatchdogsCount).toBe(1);
      expect(report.terminatedWatchdogsCount).toBe(1);
      expect(report.staleWatchdogsCount).toBe(1);
      expect(report.orphanedWatchdogsCount).toBe(1);
      expect(report.overdueWatchdogs).toEqual([]);
      expect(report.hungAgentIds).toEqual([]);
      expect(report.issues).toEqual([]);
    });

    it("detects overdue active watchdogs and captures hung agent ids", () => {
      const watchdogStore = {
        schema: "harness.watchdog_store",
        version: 1,
        updated_at: "2026-08-25T10:00:00.000Z",
        watchdogs: [
          {
            id: "wd-overdue",
            generation: 1,
            pulse_id: null,
            phase: "executing",
            run_id: null,
            run_root: null,
            pid: 12349,
            ppid: 1234,
            agent_id: "agent-hung",
            started_at: "2026-08-25T09:00:00.000Z",
            last_heartbeat_at: "2026-08-25T09:00:00.000Z",
            heartbeat_cadence_ms: 10_000,
            timeout_ms: 30_000,
            status: "active",
            terminated_at: null,
            termination_reason: null,
          },
        ],
      };

      const storePath = join(tempDir, "watchdogs.json");
      writeFileSync(storePath, JSON.stringify(watchdogStore, null, 2));

      const report = auditSupervisoryWatchdog(storePath, {
        now: "2026-08-25T10:00:00.000Z",
      });

      expect(report.healthy).toBe(false);
      expect(report.activeWatchdogsCount).toBe(1);
      expect(report.overdueWatchdogs.length).toBe(1);
      expect(report.hungAgentIds).toContain("agent-hung");
      expect(report.issues[0]).toContain(
        "Watchdog 'wd-overdue' (agent 'agent-hung') heartbeat overdue",
      );
    });
  });

  describe("recoverStaleTasks", () => {
    it("recovers stale tasks with repair round below maxRepairRounds to retry_ready", () => {
      const mockState: CapsuleStoreState = {
        schema: "harness.run-state",
        version: 1,
        tasks: {
          t1: {
            id: "t1",
            status: "running",
            requirement_ids: [],
            write_scope: ["src/a.ts"],
            repair_round: 1,
            lease: {
              agent_id: "stale-worker",
              role: "implementer",
              last_heartbeat_at: "2026-08-25T08:00:00.000Z",
              expires_at: "2026-08-25T08:30:00.000Z",
            },
          },
        },
      } as unknown as CapsuleStoreState;

      const mockPort: TransactionPort = {
        transact: (_actor, _action, _context, mutator) => {
          mutator(mockState);
          return {
            commitId: "commit-1",
            checkpoint: 1,
            hash: "hash",
            state: mockState,
            diff: { schema: "harness.state-diff", version: 1, modified: {}, deleted: [] },
          };
        },
      };

      const result = recoverStaleTasks(mockPort, {
        now: "2026-08-25T10:00:00.000Z",
        timeoutMs: 60_000,
        maxRepairRounds: 3,
      });

      expect(result.recoveredCount).toBe(1);
      expect(result.healthy).toBe(false);
      expect(result.recoveredTasks[0]?.taskId).toBe("t1");
      expect(result.recoveredTasks[0]?.fromStatus).toBe("running");
      expect(result.recoveredTasks[0]?.toStatus).toBe("retry_ready");
      expect(result.recoveredTasks[0]?.agentId).toBe("stale-worker");

      // Verify task in draft was updated
      const updatedTask = mockState.tasks["t1"] as Record<string, unknown>;
      expect(updatedTask.status).toBe("retry_ready");
      expect(updatedTask.replacement_reason).toBe("stale");
      expect(updatedTask.lease).toBeUndefined();
    });

    it("recovers stale tasks with repair round exceeding maxRepairRounds to stale", () => {
      const mockState: CapsuleStoreState = {
        schema: "harness.run-state",
        version: 1,
        tasks: {
          t2: {
            id: "t2",
            status: "leased",
            requirement_ids: [],
            write_scope: ["src/b.ts"],
            repair_round: 3, // equals maxRepairRounds (3), so transitions to stale
            lease: {
              agent_id: "exhausted-worker",
              role: "implementer",
              last_heartbeat_at: "2026-08-25T08:00:00.000Z",
              expires_at: "2026-08-25T08:30:00.000Z",
            },
          },
        },
      } as unknown as CapsuleStoreState;

      const mockPort: TransactionPort = {
        transact: (_actor, _action, _context, mutator) => {
          mutator(mockState);
          return {
            commitId: "commit-2",
            checkpoint: 2,
            hash: "hash",
            state: mockState,
            diff: { schema: "harness.state-diff", version: 1, modified: {}, deleted: [] },
          };
        },
      };

      const result = recoverStaleTasks(mockPort, {
        now: "2026-08-25T10:00:00.000Z",
        timeoutMs: 60_000,
        maxRepairRounds: 3,
      });

      expect(result.recoveredCount).toBe(1);
      expect(result.recoveredTasks[0]?.toStatus).toBe("stale");

      const updatedTask = mockState.tasks["t2"] as Record<string, unknown>;
      expect(updatedTask.status).toBe("stale");
    });

    it("returns healthy when no tasks require recovery", () => {
      const mockState: CapsuleStoreState = {
        schema: "harness.run-state",
        version: 1,
        tasks: {
          t1: {
            id: "t1",
            status: "done",
            requirement_ids: [],
            write_scope: [],
          },
        },
      } as unknown as CapsuleStoreState;

      const mockPort: TransactionPort = {
        transact: (_actor, _action, _context, mutator) => {
          mutator(mockState);
          return {
            commitId: "commit-3",
            checkpoint: 3,
            hash: "hash",
            state: mockState,
            diff: { schema: "harness.state-diff", version: 1, modified: {}, deleted: [] },
          };
        },
      };

      const result = recoverStaleTasks(mockPort, {
        now: "2026-08-25T10:00:00.000Z",
      });

      expect(result.recoveredCount).toBe(0);
      expect(result.healthy).toBe(true);
      expect(result.details).toEqual([]);
    });
  });
});

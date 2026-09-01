import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import {
  auditGraphHealth,
  auditSupervisoryWatchdog,
} from "../../../olt/scripts/src/engine/scheduler/core/state.ts";
import { cleanupVirtualEngineFS, getVirtualEngineFS, setupVirtualEngineFS } from "../fixture.ts";

describe("engine/scheduler/core/state.ts - Audit Graph & Watchdog", () => {
  const tempDir = "/virtual/state-audit-test";

  beforeEach(() => {
    setupVirtualEngineFS();
    const vfs = getVirtualEngineFS();
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualEngineFS();
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
          nodes: [{ id: "t1", type: "task" }],
          edges: [],
          gates: [
            {
              id: "gate-1",
              scope: "run",
              command: "bun test tests/engine/policy/policy-engine.test.ts",
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

    it("aggregates issues and flags unhealthy on multiple probe failures", () => {
      const state = {
        schema: "harness.run-state",
        version: 1,
        graph: {
          schema: "harness.graph",
          version: 1,
          revision: 1,
          nodes: [
            { id: "t-cycle-1", type: "task" },
            { id: "t-cycle-2", type: "task" },
          ],
          edges: [
            { source: "t-cycle-1", target: "t-cycle-2", type: "depends_on" },
            { source: "t-cycle-2", target: "t-cycle-1", type: "depends_on" },
          ],
          gates: [],
        },
        requirements: [{ id: "req-uncovered" }],
        tasks: {
          "t-cycle-1": {
            id: "t-cycle-1",
            status: "leased",
            requirement_ids: ["req-uncovered"],
            write_scope: ["src/shared.ts"],
            resource_scope: [],
            lease: {
              expires_at: "2026-08-25T08:00:00.000Z",
              agent_id: "agent-1",
              role: "implementer",
            },
          },
          "t-cycle-2": {
            id: "t-cycle-2",
            status: "leased",
            requirement_ids: ["req-uncovered"],
            write_scope: ["src/shared.ts"],
            resource_scope: [],
            lease: {
              expires_at: "2026-08-25T08:00:00.000Z",
              agent_id: "agent-2",
              role: "implementer",
            },
          },
          "t-orphan": {
            id: "t-orphan",
            status: "proposed",
            requirement_ids: [],
            write_scope: [],
            resource_scope: [],
          },
        },
      };

      const report = auditGraphHealth(state, { now: "2026-08-25T10:00:00.000Z" });
      expect(report.healthy).toBe(false);
      expect(report.totalTasks).toBe(3);
      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.probes.orphanedTasks.passed).toBe(false);
      expect(report.probes.staleLeases.passed).toBe(false);
      expect(report.probes.circularDependencies.passed).toBe(false);
      expect(report.probes.gateCoverageViolations.passed).toBe(false);
      expect(report.probes.scopeCollisionHazards.passed).toBe(false);
    });
  });

  describe("auditSupervisoryWatchdog", () => {
    it("reports healthy when watchdog store has no overdue watchdogs", () => {
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
      getVirtualEngineFS().writeFileSync(storePath, JSON.stringify(watchdogStore, null, 2));

      const report = auditSupervisoryWatchdog(storePath, {
        now: "2026-08-25T10:00:30.000Z",
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
      getVirtualEngineFS().writeFileSync(storePath, JSON.stringify(watchdogStore, null, 2));

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
});

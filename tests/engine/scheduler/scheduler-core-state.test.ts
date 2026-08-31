import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditGraphHealth,
  auditSupervisoryWatchdog,
} from "../../../olt/scripts/src/engine/scheduler/core/state.ts";

describe("engine/scheduler/core/state.ts - Audit Graph & Watchdog", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), "coverage", "scratch", `state-audit-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
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
            dependencies: ["t1"],
            lease: {
              agent_id: "agent-stale",
              role: "implementer",
              expires_at: "2026-08-25T08:00:00.000Z",
            },
          },
          t2: {
            id: "t2",
            status: "running",
            requirement_ids: [],
            write_scope: ["src/shared.ts"],
            resource_scope: [],
            dependencies: ["non_existent_orphan_parent"],
            lease: {
              agent_id: "agent-active",
              role: "implementer",
              expires_at: "2026-08-25T12:00:00.000Z",
            },
          },
        },
        requirements: [{ id: "req-uncovered" }],
        gates: [],
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
});

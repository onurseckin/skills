import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  MIND_CHARTER_INVARIANTS,
  auditAntiStagnationHealth,
  checkAntiStagnationDoctor,
  type AntiStagnationAuditReport,
  type AntiStagnationDoctorOptions,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/index.ts";
import {
  HistoricalDebateMemory,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  SupersessionIndex,
  type SupersessionIndexState,
} from "../../../olt/scripts/src/mind/memory/index.ts";
import {
  computeSnapshotChecksum,
  type SuspendedAnimationSnapshot,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  createInitialDashboardState,
  type ExecutiveDashboardState,
} from "../../../olt/scripts/src/mind/reporting/index.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

describe("Anti-Stagnation Doctor & Mind Charter Invariant Engine", () => {
describe("11. Invariant 11: Suspended Animation Protocol", () => {
    it("detects corrupted snapshot checksum as SUSPENDED_ANIMATION_PROTOCOL violation", () => {
      const nowMs = Date.now();
      const corruptedSnapshot: SuspendedAnimationSnapshot = {
        schemaVersion: "1.0.0",
        snapshotId: "susp-corrupt-01",
        suspendedAtIso: new Date(nowMs).toISOString(),
        suspendedAtMs: nowMs,
        reason: "QUOTA_EXHAUSTION",
        governorState: "HIBERNATING",
        tasksDag: [],
        frozenTimers: [],
        activeWatchdogs: [],
        contextState: {},
        checksum: "invalid_checksum_hash", // Tampered
      };

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        suspendedSnapshot: corruptedSnapshot,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "SUSPENDED_ANIMATION_PROTOCOL");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("checksum verification failed");
    });

    it("passes when suspended snapshot has valid checksum and acyclic DAG", () => {
      const nowMs = Date.now();
      const base = {
        schemaVersion: "1.0.0",
        snapshotId: "susp-valid-01",
        suspendedAtIso: new Date(nowMs).toISOString(),
        suspendedAtMs: nowMs,
        reason: "QUOTA_EXHAUSTION",
        governorState: "HIBERNATING" as const,
        tasksDag: [
          {
            taskId: "T-1",
            title: "Task 1",
            status: "SUSPENDED",
            priority: "HIGH",
            dependencies: [],
            dependents: ["T-2"],
            suspendedAtMs: nowMs,
          },
          {
            taskId: "T-2",
            title: "Task 2",
            status: "SUSPENDED",
            priority: "HIGH",
            dependencies: ["T-1"],
            dependents: [],
            suspendedAtMs: nowMs,
          },
        ],
        frozenTimers: [
          {
            id: "timer-1",
            timerType: "anti_stagnation" as const,
            originalDurationMs: 180000,
            elapsedMs: 60000,
            remainingDurationMs: 120000,
            registeredAtMs: nowMs - 60000,
            frozenAtMs: nowMs,
          },
        ],
        activeWatchdogs: [],
        contextState: { runId: "mind-gen-1" },
      };

      const checksum = computeSnapshotChecksum(base);
      const validSnapshot: SuspendedAnimationSnapshot = {
        ...base,
        checksum,
      };

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        suspendedSnapshot: validSnapshot,
      };

      const result = checkAntiStagnationDoctor(options);
      const suspendedViolations = result.findings.filter((f) => f.code === "SUSPENDED_ANIMATION_PROTOCOL");
      expect(suspendedViolations).toHaveLength(0);
    });
  });

describe("12. Invariant 14: Live Executive Dashboard Freshness", () => {
    it("flags missing executive dashboard in active Mind capsule", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1, active: true },
          pulse: { counter: 1 },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "LIVE_EXECUTIVE_DASHBOARD");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
    });

    it("warns when dashboard timestamp exceeds 5m staleness latency threshold", () => {
      const oldTime = new Date(Date.now() - 400_000).toISOString(); // 400s old > 300s
      const dashState = createInitialDashboardState();
      const staleDash: ExecutiveDashboardState = {
        ...dashState,
        generatedAt: oldTime,
        trajectory: {
          ...dashState.trajectory,
          lastUpdated: oldTime,
        },
      };

      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          pulse: { counter: 2 },
          dashboard: staleDash,
        },
        nowMs: Date.now(),
      };

      const result = checkAntiStagnationDoctor(options);
      const finding = result.findings.find((f) => f.code === "LIVE_EXECUTIVE_DASHBOARD");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("WARN");
      expect(finding?.message).toContain("stale");
    });
  });

describe("13. Invariant 15: Mandatory 3-Round Socratic Laddering", () => {
    it("flags consensus recorded at L1 without traversing L2 and L3 rounds", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          socratic: {
            consensusReached: true,
            history: [
              { id: "ex-1", level: "L1_TRADE_OFF_VERIFICATION", inquiry: "Q1" }, // Skipped L2 and L3
            ],
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "MANDATORY_3_ROUND_SOCRATIC_LADDERING");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Consensus recorded without traversing all 3 mandatory dialectical rounds");
    });
  });

describe("14. Invariant 16: Direct 1-on-1 Conversational Audits", () => {
    it("flags Tier 0 Mind directly granting Tier 3 Implementer as cross-tier bypass", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          grants: [
            { id: "mind-1", role: "mind", parent_agent_id: null },
            { id: "impl-bypass-1", role: "implementer", parent_agent_id: "mind-1" }, // Direct bypass of Coordinator
          ],
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "DIRECT_1_ON_1_CONVERSATIONAL_AUDITS");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Cross-tier bypass");
    });
  });

describe("15. auditAntiStagnationHealth Sub-Report Aggregations", () => {
    it("compiles structured AntiStagnationAuditReport with all sub-reports", () => {
      const runRoot = initRun(
        tempDir,
        "test-mind-run",
        new TextEncoder().encode("Mind test prompt"),
        "file",
        true,
      );

      const memory = new HistoricalDebateMemory([], []);
      const index = new SupersessionIndex([
        { id: "inv-1", title: "Invariant 1", status: "ACTIVE", timestamp: new Date().toISOString() },
      ]);

      const report: AntiStagnationAuditReport = auditAntiStagnationHealth(runRoot, {
        repoRoot: tempDir,
        socraticMemory: memory,
        supersessionIndex: index,
      });

      expect(report).toBeDefined();
      expect(report.runRoot).toBe(runRoot);
      expect(report.invariantsChecked).toBe(16);
      expect(typeof report.healthy).toBe("boolean");
      expect(report.supervisoryPurity).toBeDefined();
      expect(report.supervisoryPurity.pure).toBe(true);
      expect(report.socraticMemoryHealth).toBeDefined();
      expect(report.socraticMemoryHealth.intact).toBe(true);
      expect(report.supersessionIndexingHealth).toBeDefined();
      expect(report.supersessionIndexingHealth.acyclic).toBe(true);
      expect(report.supersessionIndexingHealth.nodeCount).toBe(1);
    });
  });
});

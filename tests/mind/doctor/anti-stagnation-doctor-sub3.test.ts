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
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(process.cwd(), "tmp-doctor-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("9. Invariant 8: Ergonomic Walkthrough & Product Craft", () => {
    it("flags blocking aesthetic deficits as ERGONOMIC_WALKTHROUGH_AUDITING violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          product_craft: {
            ergonomicWalkthroughStatus: "DEFICIT_NOTICE",
            compositeCraftScore: 78.0,
            passThreshold: 85.0,
            openDeficits: { blockingCount: 2, totalOpen: 2 },
            microInteractionLatencyMs: 34.0,
            microInteractionTargetMs: 16.0,
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "ERGONOMIC_WALKTHROUGH_AUDITING");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("blocking aesthetic deficit");
    });
  });

  describe("10. Invariant 10: Epistemic Supersession Indexing Acyclicity", () => {
    it("detects cyclic lineage in supersession index graph", () => {
      const cyclicIndex = new SupersessionIndex([
        {
          id: "A",
          title: "Node A",
          status: "SUPERSEDED",
          supersededBy: "B",
          timestamp: new Date().toISOString(),
        },
        {
          id: "B",
          title: "Node B",
          status: "SUPERSEDED",
          supersededBy: "C",
          timestamp: new Date().toISOString(),
        },
        {
          id: "C",
          title: "Node C",
          status: "SUPERSEDED",
          supersededBy: "A",
          timestamp: new Date().toISOString(),
        }, // Cycle A -> B -> C -> A
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        supersessionIndex: cyclicIndex,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "EPISTEMIC_SUPERSESSION_INDEXING");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("cycle(s) detected in supersession lineage graph");
    });

    it("passes cleanly when supersession index is strictly acyclic", () => {
      const acyclicIndex = new SupersessionIndex([
        {
          id: "A",
          title: "Node A",
          status: "SUPERSEDED",
          supersededBy: "B",
          timestamp: new Date().toISOString(),
        },
        {
          id: "B",
          title: "Node B",
          status: "SUPERSEDED",
          supersededBy: "C",
          timestamp: new Date().toISOString(),
        },
        { id: "C", title: "Node C", status: "ACTIVE", timestamp: new Date().toISOString() },
      ]);

      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        supersessionIndex: acyclicIndex,
      };

      const result = checkAntiStagnationDoctor(options);
      const supersessionViolations = result.findings.filter(
        (f) => f.code === "EPISTEMIC_SUPERSESSION_INDEXING",
      );
      expect(supersessionViolations).toHaveLength(0);
    });
  });

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
      const suspendedViolations = result.findings.filter(
        (f) => f.code === "SUSPENDED_ANIMATION_PROTOCOL",
      );
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
});

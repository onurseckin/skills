import { describe, expect, it } from "bun:test";
import { evaluateSystemHealth } from "../../../olt/scripts/src/liaison/monitoring/health.ts";
import {
  buildMonitoringSnapshot,
  buildMonitoringSnapshotFromRaw,
  MonitoringSurface,
} from "../../../olt/scripts/src/liaison/monitoring/surface.ts";
import type {
  AgentIdentityInfo,
  DriftItem,
  ObligationDirective,
  SharedMetricItem,
  SystemLivenessInfo,
  SystemObligationSummary,
  SystemRosterMetrics,
  SystemRunStateInfo,
} from "../../../olt/scripts/src/liaison/monitoring/types.ts";

export const surfaceSuiteName = "Monitoring Surface & Health Evaluator";

describe(surfaceSuiteName, () => {
  const healthyLiveness: SystemLivenessInfo = Object.freeze({
    systemId: "antigravity",
    lastHeartbeatTimestamp: new Date().toISOString(),
    ageSeconds: 5,
    declaredIntervalSeconds: 15,
    consecutiveMissedBeats: 0,
    status: "ALIVE",
    statusMessage: "Operational",
    activeRunIds: Object.freeze(["run-cross-system"]),
  });

  const healthyRoster: SystemRosterMetrics = Object.freeze({
    activeAgents: Object.freeze([]),
    totalActiveAgents: 3,
    implementerCount: 3,
    distinctImplementers: 3,
    distinctImplementerIdentities: Object.freeze(["imp-1", "imp-2", "imp-3"]),
    laneCount: 3,
    lanesPerImplementerRatio: 1.0,
    isSerialExecutionRisk: false,
    serialExecutionWarning: null,
  });

  const healthyObligations: SystemObligationSummary = Object.freeze({
    obligations: Object.freeze([]),
    totalObligations: 2,
    openCount: 0,
    boundCount: 2,
    refusedCount: 0,
    overdueCount: 0,
  });

  describe("evaluateSystemHealth", () => {
    it("reports HEALTHY and isWorkingWell = true on clean system state", () => {
      const health = evaluateSystemHealth({
        liveness: healthyLiveness,
        roster: healthyRoster,
        obligations: healthyObligations,
      });

      expect(health.status).toBe("HEALTHY");
      expect(health.healthScore).toBe(100);
      expect(health.isWorkingWell).toBe(true);
      expect(health.concerns).toHaveLength(0);
      expect(health.reasons.length).toBeGreaterThan(0);
    });

    it("penalizes unreachable peer heavily to prevent 81m blind outages (forensics §2.4)", () => {
      const unreachableLiveness: SystemLivenessInfo = {
        ...healthyLiveness,
        status: "UNREACHABLE",
        consecutiveMissedBeats: 4,
        ageSeconds: 240,
      };

      const health = evaluateSystemHealth({
        liveness: unreachableLiveness,
        roster: healthyRoster,
        obligations: healthyObligations,
      });

      expect(health.healthScore).toBeLessThanOrEqual(50);
      expect(health.isWorkingWell).toBe(false);
      expect(health.concerns.some((c) => c.includes("Peer unreachable"))).toBe(true);
      expect(health.recommendations.some((r) => r.includes("Restart peer liaison daemon"))).toBe(
        true,
      );
    });

    it("penalizes serial execution masquerading as parallel plan (forensics §2.9)", () => {
      const serialRoster: SystemRosterMetrics = {
        ...healthyRoster,
        distinctImplementers: 1,
        laneCount: 4,
        lanesPerImplementerRatio: 4.0,
        isSerialExecutionRisk: true,
        serialExecutionWarning: "Serial execution detected: single implementer serving 4 lanes",
      };

      const health = evaluateSystemHealth({
        liveness: healthyLiveness,
        roster: serialRoster,
        obligations: healthyObligations,
      });

      expect(health.healthScore).toBeLessThan(85);
      expect(health.isWorkingWell).toBe(false);
      expect(health.concerns.some((c) => c.includes("Serial execution detected"))).toBe(true);
    });

    it("penalizes overdue obligations without phase-2 binding", () => {
      const overdueObligations: SystemObligationSummary = {
        ...healthyObligations,
        openCount: 2,
        overdueCount: 2,
      };

      const health = evaluateSystemHealth({
        liveness: healthyLiveness,
        roster: healthyRoster,
        obligations: overdueObligations,
      });

      expect(health.healthScore).toBeLessThan(85);
      expect(health.concerns.some((c) => c.includes("overdue without Phase-2"))).toBe(true);
    });

    it("penalizes unabsorbed ratchet drift regressions", () => {
      const regressedDrift: readonly DriftItem[] = Object.freeze([
        {
          metricName: "testPassRate",
          baselineValue: 100,
          currentValue: 80,
          delta: -20,
          direction: "regressed",
          isRegression: true,
          absorbedRegressionAllowed: false,
        },
      ]);

      const health = evaluateSystemHealth({
        liveness: healthyLiveness,
        roster: healthyRoster,
        obligations: healthyObligations,
        drift: regressedDrift,
      });

      expect(health.healthScore).toBeLessThan(100);
      expect(health.concerns.some((c) => c.includes("Unabsorbed ratchet regression"))).toBe(true);
    });
  });

  describe("Read-Only Guarantees & Immutability", () => {
    it("never mutates input objects and returns deeply frozen snapshot", () => {
      const sharedMetrics: SharedMetricItem[] = [
        {
          name: "localUiImportsTier1",
          value: 42,
          computationDefinition: 'imports matching exact "@limo/design-system*" AST tokens',
          computedAt: new Date().toISOString(),
          authority: "liaison_daemon",
        },
      ];

      const runState: SystemRunStateInfo = {
        runId: "run-cross-sys",
        status: "running",
        lanes: [
          {
            laneId: "lane-1",
            status: "running",
            leaseHolder: "imp-1",
            writeScope: ["src/ui"],
          },
        ],
        unclaimedReadyLanes: [],
        activeLeaseHolders: ["imp-1"],
        totalLanes: 1,
      };

      const snapshot = buildMonitoringSnapshot({
        systemId: "antigravity",
        liveness: healthyLiveness,
        roster: healthyRoster,
        obligations: healthyObligations,
        runState,
        sharedMetrics,
      });

      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.sharedMetrics)).toBe(true);
      expect(Object.isFrozen(snapshot.liveness)).toBe(true);
      expect(Object.isFrozen(snapshot.health)).toBe(true);

      // Verify original arrays were not mutated or replaced
      expect(sharedMetrics).toHaveLength(1);
      expect(sharedMetrics[0]?.value).toBe(42);
    });

    it("builds snapshot from raw arrays using helper", () => {
      const rawAgents: readonly AgentIdentityInfo[] = [
        { agentId: "imp-a", roleType: "implementer", status: "active" },
        { agentId: "imp-b", roleType: "implementer", status: "active" },
      ];

      const rawDirective: ObligationDirective = {
        directiveId: "d1",
        correlationId: "c1",
        senderId: "planner",
        recipientId: "liaison",
        timestamp: new Date().toISOString(),
        description: "Test task",
        namedPaths: ["path/a"],
        overdueWindowSeconds: 60,
      };

      const snapshot = buildMonitoringSnapshotFromRaw({
        systemId: "claude",
        liveness: healthyLiveness,
        agents: rawAgents,
        laneCount: 2,
        obligations: [{ directive: rawDirective, boundAt: new Date().toISOString() }],
      });

      expect(snapshot.systemId).toBe("claude");
      expect(snapshot.roster.distinctImplementers).toBe(2);
      expect(snapshot.obligations.boundCount).toBe(1);
    });

    it("MonitoringSurface class provides instance interface", () => {
      const surface = new MonitoringSurface();
      const snapshot = surface.getSnapshot({
        systemId: "antigravity",
        liveness: healthyLiveness,
        roster: healthyRoster,
        obligations: healthyObligations,
      });

      expect(snapshot.systemId).toBe("antigravity");
      expect(snapshot.health.isWorkingWell).toBe(true);
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  countAgentsByRole,
  detectSerialExecution,
  extractRosterMetrics,
  groupAgentsByRole,
} from "../../../olt/scripts/src/liaison/monitoring/roster.ts";
import type { AgentIdentityInfo } from "../../../olt/scripts/src/liaison/monitoring/types.ts";

export const rosterSuiteName = "Roster Metrics & Concurrency Analyzer";

describe(rosterSuiteName, () => {
  const sampleAgents: readonly AgentIdentityInfo[] = Object.freeze([
    {
      agentId: "liaison_claude",
      roleType: "liaison",
      status: "active",
    },
    {
      agentId: "orchestrator_main",
      roleType: "orchestrator",
      status: "active",
    },
    {
      agentId: "coordinator_wave42",
      roleType: "coordinator",
      status: "active",
    },
    {
      agentId: "implementer_lane1",
      roleType: "implementer",
      laneId: "lane-ui",
      status: "active",
    },
    {
      agentId: "implementer_lane2",
      roleType: "implementer",
      laneId: "lane-api",
      status: "active",
    },
    {
      agentId: "validator_ui",
      roleType: "validator",
      status: "active",
    },
  ]);

  it("extracts distinct implementers as a first-class number", () => {
    const metrics = extractRosterMetrics(sampleAgents, 2);

    expect(metrics.totalActiveAgents).toBe(6);
    expect(metrics.implementerCount).toBe(2);
    expect(metrics.distinctImplementers).toBe(2);
    expect(metrics.distinctImplementerIdentities).toEqual([
      "implementer_lane1",
      "implementer_lane2",
    ]);
    expect(metrics.laneCount).toBe(2);
    expect(metrics.lanesPerImplementerRatio).toBe(1.0);
    expect(metrics.isSerialExecutionRisk).toBe(false);
    expect(metrics.serialExecutionWarning).toBeNull();
  });

  it("detects serial execution masquerading as parallel plan (forensics §2.9)", () => {
    // One implementer assigned to 4 disjoint lanes
    const serialAgents: readonly AgentIdentityInfo[] = Object.freeze([
      {
        agentId: "implementer_solo",
        roleType: "implementer",
        status: "active",
      },
    ]);

    const metrics = extractRosterMetrics(serialAgents, 4);

    expect(metrics.implementerCount).toBe(1);
    expect(metrics.distinctImplementers).toBe(1);
    expect(metrics.laneCount).toBe(4);
    expect(metrics.lanesPerImplementerRatio).toBe(4.0);
    expect(metrics.isSerialExecutionRisk).toBe(true);
    expect(metrics.serialExecutionWarning).toContain("Serial execution detected");
    expect(metrics.serialExecutionWarning).toContain("single implementer");
    expect(metrics.serialExecutionWarning).toContain("forensics §2.9");
  });

  it("detects serial bottleneck when distinct implementers is fewer than lanes", () => {
    const bottleneckAgents: readonly AgentIdentityInfo[] = Object.freeze([
      { agentId: "imp_1", roleType: "implementer", status: "active" },
      { agentId: "imp_2", roleType: "implementer", status: "active" },
    ]);

    const metrics = extractRosterMetrics(bottleneckAgents, 4);

    expect(metrics.distinctImplementers).toBe(2);
    expect(metrics.laneCount).toBe(4);
    expect(metrics.lanesPerImplementerRatio).toBe(2.0);
    expect(metrics.isSerialExecutionRisk).toBe(true);
    expect(metrics.serialExecutionWarning).toContain("Serial bottleneck");
  });

  it("detects zero implementers active for positive lane count", () => {
    const nonImplementerAgents: readonly AgentIdentityInfo[] = Object.freeze([
      { agentId: "coord_1", roleType: "coordinator", status: "active" },
    ]);

    const metrics = extractRosterMetrics(nonImplementerAgents, 3);

    expect(metrics.distinctImplementers).toBe(0);
    expect(metrics.laneCount).toBe(3);
    expect(metrics.lanesPerImplementerRatio).toBe(Infinity);
    expect(metrics.isSerialExecutionRisk).toBe(true);
    expect(metrics.serialExecutionWarning).toContain("Zero implementers active");
  });

  it("handles zero lanes and zero implementers cleanly", () => {
    const result = detectSerialExecution(0, 0);

    expect(result.isRisk).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.ratio).toBe(0);
  });

  it("groups agents by role type correctly", () => {
    const grouped = groupAgentsByRole(sampleAgents);

    expect(grouped.liaison).toHaveLength(1);
    expect(grouped.orchestrator).toHaveLength(1);
    expect(grouped.coordinator).toHaveLength(1);
    expect(grouped.implementer).toHaveLength(2);
    expect(grouped.validator).toHaveLength(1);
    expect(grouped.critic).toHaveLength(0);
    expect(grouped.auditor).toHaveLength(0);
  });

  it("counts agents by role correctly", () => {
    const counts = countAgentsByRole(sampleAgents);

    expect(counts.liaison).toBe(1);
    expect(counts.orchestrator).toBe(1);
    expect(counts.coordinator).toBe(1);
    expect(counts.implementer).toBe(2);
    expect(counts.validator).toBe(1);
    expect(counts.unknown).toBe(0);
  });

  it("preserves immutability of agents list", () => {
    const input = [{ agentId: "a1", roleType: "implementer" as const, status: "active" as const }];
    const metrics = extractRosterMetrics(input, 1);

    expect(Object.isFrozen(metrics)).toBe(true);
    expect(Object.isFrozen(metrics.activeAgents)).toBe(true);
    expect(Object.isFrozen(metrics.distinctImplementerIdentities)).toBe(true);
  });
});

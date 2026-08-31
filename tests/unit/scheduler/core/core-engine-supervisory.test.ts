import { describe, expect, test } from "bun:test";
import {
  auditSupervisory5PointHealth,
  determineTopLeader,
  dispatchSupervisoryHealthProbe,
  formatSupervisoryHealthMarkdown,
  probeAgentRegistryAccuracy,
  probePlanEnhancementNeeds,
  probeRoleBoundaryAdherence,
  probeWorkSpanParallelizationHealth,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import { schedulerState } from "../fixtures.ts";

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
      agent_id: "ghost-worker-99",
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
      role: "implementer",
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

    const formattedMd = formatSupervisoryHealthMarkdown(report);
    expect(formattedMd).toContain("Two-Way Supervisory Watchdog 5-Point Health Probe");
  });

  test("fails closed when supplied doctor evidence is unhealthy, malformed, or unavailable", () => {
    const state = schedulerState();
    const healthy = auditSupervisory5PointHealth(state, {
      doctorResult: { healthy: true, issues: [] },
    });
    expect(healthy.doctorResolution.passed).toBeTrue();
    for (const doctorResult of [
      { healthy: false, issues: [] },
      { healthy: true, issues: ["valid", 3] },
    ]) {
      const report = auditSupervisory5PointHealth(state, { doctorResult });
      expect(report.healthy).toBeFalse();
      expect(report.doctorResolution.passed).toBeFalse();
    }

    const unavailable = auditSupervisory5PointHealth(state, {
      runRoot: "/definitely-missing-supervisory-capsule",
    });
    expect(unavailable.healthy).toBeFalse();
    expect(unavailable.roleBoundaryAdherence.details.join(" ")).toContain(
      "behavioral_evidence_unavailable",
    );
    expect(unavailable.markdown).not.toContain("🟢 HEALTHY");
  });
});

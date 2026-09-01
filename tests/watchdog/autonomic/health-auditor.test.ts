import { describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import {
  defaultProcessLivenessChecker,
  HealthAuditor,
} from "../../../olt/scripts/src/watchdog/autonomic-watchdog/health-auditor.ts";
import type {
  AgentActivityState,
  WatchdogFinding,
} from "../../../olt/scripts/src/watchdog/autonomic-watchdog/types.ts";

describe("HealthAuditor & Process Liveness Auditing", () => {
  it("defaultProcessLivenessChecker returns false for invalid PIDs and catches kill signals", () => {
    expect(defaultProcessLivenessChecker(0)).toBe(false);
    expect(defaultProcessLivenessChecker(-10)).toBe(false);
    expect(defaultProcessLivenessChecker(Number.NaN)).toBe(false);
    expect(defaultProcessLivenessChecker(Number.POSITIVE_INFINITY)).toBe(false);
    expect(defaultProcessLivenessChecker(process.pid)).toBe(true);
  });

  it("checks individual process health and updates boot gate and activity records", () => {
    const enforcer = new BootGateEnforcer();
    const activities = new Map<string, AgentActivityState>();
    enforcer.registerSpawnedSubagent({ agentId: "agent-1", role: "implementer", pid: 1234 });
    activities.set("agent-1", {
      agentId: "agent-1",
      taskId: "task-1",
      pid: 1234,
      lastHeartbeatAt: 1700000000000,
      lastActivityAt: 1700000000000,
      status: "active",
    });

    const livePids = new Set<number>([1234]);
    const auditor = new HealthAuditor({
      timeoutMs: 60_000,
      capsuleRoot: null,
      bootGateEnforcer: enforcer,
      activities,
      processLivenessChecker: (pid) => livePids.has(pid),
    });

    const statusLive = auditor.checkProcessHealth(1234, "agent-1", 1700000001000);
    expect(statusLive.alive).toBe(true);
    expect(statusLive.agentId).toBe("agent-1");
    expect(activities.get("agent-1")?.lastProcessHealth?.alive).toBe(true);

    const statusDead = auditor.checkProcessHealth(9999, "agent-1", 1700000002000);
    expect(statusDead.alive).toBe(false);
    expect(statusDead.error).toContain("is not running");
  });

  it("audits all processes across both boot gate records and activity maps", () => {
    const enforcer = new BootGateEnforcer();
    const activities = new Map<string, AgentActivityState>();
    enforcer.registerSpawnedSubagent({ agentId: "agent-enforcer", role: "implementer", pid: 100 });
    activities.set("agent-act-only", {
      agentId: "agent-act-only",
      taskId: "task-2",
      pid: 200,
      lastHeartbeatAt: 1700000000000,
      lastActivityAt: 1700000000000,
      status: "active",
    });

    const auditor = new HealthAuditor({
      timeoutMs: 60_000,
      capsuleRoot: null,
      bootGateEnforcer: enforcer,
      activities,
      processLivenessChecker: () => true,
    });

    const procResults = auditor.auditProcessHealth(1700000000000);
    expect(procResults.length).toBe(2);
    expect(procResults.map((r) => r.pid).sort()).toEqual([100, 200]);
  });

  it("performs comprehensive health audit and detects stalled agents, dead processes, and missing gates", async () => {
    const enforcer = new BootGateEnforcer();
    const activities = new Map<string, AgentActivityState>();

    // 1. Compliant agent
    enforcer.registerSpawnedSubagent({ agentId: "agent-ok", role: "implementer", pid: 1001 });
    enforcer.recordWhoamiExecution("agent-ok");
    enforcer.recordDoctorExecution("agent-ok");
    activities.set("agent-ok", {
      agentId: "agent-ok",
      taskId: "task-ok",
      pid: 1001,
      lastHeartbeatAt: 1700000050000,
      lastActivityAt: 1700000050000,
      status: "active",
    });

    // 2. Stalled agent
    enforcer.registerSpawnedSubagent({ agentId: "agent-stalled", role: "implementer", pid: 1002 });
    enforcer.recordWhoamiExecution("agent-stalled");
    enforcer.recordDoctorExecution("agent-stalled");
    activities.set("agent-stalled", {
      agentId: "agent-stalled",
      taskId: "task-stalled",
      pid: 1002,
      lastHeartbeatAt: 1700000000000, // 60s ago
      lastActivityAt: 1700000000000,
      status: "active",
    });

    // 3. Dead process agent
    enforcer.registerSpawnedSubagent({ agentId: "agent-dead", role: "implementer", pid: 1003 });
    enforcer.recordWhoamiExecution("agent-dead");
    enforcer.recordDoctorExecution("agent-dead");
    activities.set("agent-dead", {
      agentId: "agent-dead",
      taskId: "task-dead",
      pid: 1003,
      lastHeartbeatAt: 1700000050000,
      lastActivityAt: 1700000050000,
      status: "active",
    });

    // 4. Rogue agent without boot gates
    enforcer.registerSpawnedSubagent({ agentId: "agent-rogue", role: "implementer" });

    const livePids = new Set<number>([1001, 1002]);
    const stalledFindings: WatchdogFinding[] = [];
    const procFailureFindings: WatchdogFinding[] = [];

    const auditor = new HealthAuditor({
      timeoutMs: 30_000,
      capsuleRoot: null,
      bootGateEnforcer: enforcer,
      activities,
      processLivenessChecker: (pid) => livePids.has(pid),
      onStallDetected: (_, finding) => {
        stalledFindings.push(finding);
      },
      onProcessFailureDetected: (_, __, finding) => {
        procFailureFindings.push(finding);
      },
    });

    const report = await auditor.auditHealth(1700000060000);
    expect(report.healthy).toBe(false);
    expect(report.stalledAgentsCount).toBe(1);
    expect(report.deadProcessesCount).toBe(1);
    expect(report.bootGateViolationsCount).toBe(1);
    expect(report.subagentCount).toBe(4);
    expect(stalledFindings.length).toBe(1);
    expect(procFailureFindings.length).toBe(1);
    expect(report.summary).toContain("Autonomic watchdog detected issues");
  });
});

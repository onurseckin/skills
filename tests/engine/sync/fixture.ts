import type { DomainCommitRecord, DomainLedgerState } from "../../../olt/scripts/src/engine/worktree/index.ts";
import type { SchedulerProgressSnapshot } from "../../../olt/scripts/src/engine/scheduler/reporting/index.ts";

export function createTestDomainCommit(domain = "domain-test", taskId = "task-1"): DomainCommitRecord {
  return {
    taskId,
    domain,
    worktreeId: `domain-${domain}`,
    sha: "test-sha-123456",
    subject: `feat(${domain}): test commit`,
    changedLines: 15,
    overLimit: false,
    committedAt: new Date().toISOString(),
    pushed: true,
  };
}

export function createTestDomainLedger(harnessBranch = "main"): DomainLedgerState {
  return {
    harnessBranch,
    baseSha: "base-sha-000",
    root: ".capsules/worktrees",
    domains: {},
    commits: [],
    syncHistory: [],
  };
}

export function createTestProgressSnapshot(overrides: Partial<SchedulerProgressSnapshot> = {}): SchedulerProgressSnapshot {
  return {
    capturedAt: "2026-08-31T01:00:00.000Z",
    runRoot: "test-run",
    totalTasks: 2,
    completedTasks: 0,
    leasedTasks: 1,
    readyTasks: 1,
    proposedTasks: 0,
    failedTasks: 0,
    tasks: [],
    waves: [],
    activeAgents: [{ id: "worker-1", role: "implementer", host: "claude-code" }],
    activeWave: 1,
    totalWaves: 1,
    quotaUsedToday: 1,
    quotaLimitToday: 50,
    wallClockMsToday: 1000,
    ...overrides,
  };
}

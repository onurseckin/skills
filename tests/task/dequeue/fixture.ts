import type { CompletionReceipts, TaskLease } from "../../../olt/scripts/src/task/queue/index.ts";

export function createSampleTaskLease(overrides: Partial<TaskLease> = {}): TaskLease {
  return {
    leaseId: "lease-sample-01",
    holder: "agent-implementer-01",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ...overrides,
  };
}

export function createSampleCompletionReceipts(
  overrides: Partial<CompletionReceipts> = {},
): CompletionReceipts {
  return {
    verifiedCommit: "abc1234def5678",
    verificationSummary: "All unit tests pass with zero regressions",
    validatorVerdict: "passed",
    artifactsArchive: "coverage/receipts/task-sample-01.json",
    ...overrides,
  };
}

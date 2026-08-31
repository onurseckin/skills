/**
 * @file index.ts
 * Facade for tests/scheduler/feedback/ test suite
 */

export const SCHEDULER_FEEDBACK_SUITES = [
  "active-authority.test.ts",
  "conflicts.test.ts",
  "critic-feedback.test.ts",
  "critic-normalization.test.ts",
  "critic-repair-dag.test.ts",
  "meta-auditor-policy.test.ts",
  "script-backed-diagnostics-receipts.test.ts",
  "script-backed-diagnostics.test.ts",
  "skill-auditor-policy.test.ts",
] as const;

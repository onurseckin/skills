export { SCHEDULER_FEEDBACK_CRITIC_SUITES } from "./critic/index.ts";
export { SCHEDULER_FEEDBACK_DIAGNOSTICS_SUITES } from "./diagnostics/index.ts";

export const SCHEDULER_FEEDBACK_SUITES = [
  "active-authority.test.ts",
  "conflicts.test.ts",
  "critic-feedback-remediation.test.ts",
  "critic-feedback.test.ts",
  "critic-normalization.test.ts",
  "critic-repair-convergence.test.ts",
  "critic-repair-dag.test.ts",
  "meta-auditor-policy.test.ts",
  "script-backed-diagnostics-receipts.test.ts",
  "script-backed-diagnostics.test.ts",
  "skill-auditor-policy.test.ts",
] as const;

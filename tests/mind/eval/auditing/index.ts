/**
 * @file index.ts
 * Facade for Mind Eval Auditing subpackage
 */

export const EVAL_AUDITING_SUITES = [
  "orchestrator-liveness",
  "charter-auditing",
  "auditor-role",
  "hardening-invariants",
  "stagnation-auditor",
  "liveness-and-scope",
  "role-auditing",
  "exhaustive-checks",
] as const;

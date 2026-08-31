/**
 * @file index.ts
 * Facade for Mind Eval Scanner subpackage
 */

export const EVAL_SCANNER_SUITES = [
  "health-scanner",
  "remediation-scanner",
  "quota-evaluation",
  "pulse-governance",
  "candidate-decline",
  "audit-questionnaire",
  "audit-verification",
  "audit-planted",
] as const;

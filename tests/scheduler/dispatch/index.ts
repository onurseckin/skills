/**
 * @file index.ts
 * Facade for tests/scheduler/dispatch/ test suite
 */

export const SCHEDULER_DISPATCH_SUITES = [
  "multi-domain-dispatch-conflicts.test.ts",
  "multi-domain-dispatch.test.ts",
  "multi-domain-eligibility.test.ts",
  "multi-domain-engine.test.ts",
  "multi-domain-implementers.test.ts",
  "multi-domain-isolation.test.ts",
  "multi-domain-pairing.test.ts",
  "multi-domain-validators.test.ts",
] as const;

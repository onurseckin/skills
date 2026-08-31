/**
 * @file index.ts
 * Facade for Telemetry Quota test suite.
 */

export const quotaSuite = [
  "quota-lifecycle-enforcement",
  "quota-lifecycle-transitions",
  "quota-unknown-safety",
] as const;

/**
 * @file index.ts
 * Facade for tests/scheduler/core/ test suite
 */

export const SCHEDULER_CORE_SUITES = [
  "batch.test.ts",
  "core-engine-probes.test.ts",
  "core-engine-supervisory.test.ts",
  "core-engine-watchdog.test.ts",
  "core-engine.test.ts",
  "decision-tree.test.ts",
  "host-cadence.test.ts",
  "parallel-enforcer.test.ts",
  "queue-wave.test.ts",
] as const;

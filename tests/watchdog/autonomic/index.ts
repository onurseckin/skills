/**
 * @file index.ts
 * Facade for tests/watchdog/autonomic/ test suite
 */

export const WATCHDOG_AUTONOMIC_SUITES = [
  "autonomic-engine.test.ts",
  "adaptive-timer.test.ts",
  "activity-tracker.test.ts",
  "health-auditor.test.ts",
  "cli-reporter.test.ts",
  "event-emitter.test.ts",
  "reactive-dispatcher.test.ts",
] as const;

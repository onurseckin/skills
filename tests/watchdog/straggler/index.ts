/**
 * @file index.ts
 * Facade for tests/watchdog/straggler/ test suite
 */

export const WATCHDOG_STRAGGLER_SUITES = [
  "straggler-watchdog-lifecycle.test.ts",
  "straggler-remediation.test.ts",
] as const;

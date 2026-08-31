/**
 * @file index.ts
 * Facade for tests/watchdog/timeout/ test suite
 */

export const WATCHDOG_TIMEOUT_SUITES = [
  "process-timeout-runner.test.ts",
  "process-timeout-monitor.test.ts",
  "kill-tree.test.ts",
  "hierarchical-stall-probe.test.ts",
  "remediation.test.ts",
  "diagnostics.test.ts",
] as const;

/**
 * @file index.ts
 * Facade for tests/watchdog/boot/ test suite
 */

export const WATCHDOG_BOOT_SUITES = [
  "boot-gate-enforcer.test.ts",
  "boot-state-auditor.test.ts",
  "live-cli-proof.test.ts",
  "formatter.test.ts",
] as const;

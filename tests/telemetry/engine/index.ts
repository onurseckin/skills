/**
 * @file index.ts
 * Facade for Telemetry Engine test suite.
 */

export const engineSuite = [
  "engine-formatting",
  "engine-lifecycle",
  "raw-field-allowlist",
  "secret-redaction",
  "trace-context",
  "usage-report",
] as const;

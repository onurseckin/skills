/**
 * @file index.ts
 * Facade for Telemetry Snapshot test suite.
 */

export const snapshotSuite = [
  "snapshot-capture",
  "snapshot-formatting",
  "snapshot-persistence",
  "snapshot-resume",
] as const;

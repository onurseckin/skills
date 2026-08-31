/**
 * @file index.ts
 * Facade for Snapshot Trees, DOM Physics Extraction, Event Ledgers, and Manifests
 */

export const CAPTURE_SNAPSHOT_SUITES = [
  "dom-physics-script",
  "dom-physics-metrics",
  "snapshot-tree",
  "snapshot-persistence",
  "event-ledger",
  "png-ihdr-validator",
  "synthetic-manifest",
  "runner-manifest-writer",
  "runner-manifest-schema",
] as const;

/**
 * @file index.ts
 * Facade for Mind Defects modular subpackage
 */

export {
  createMockResolutionProof,
  createMockDefectEntry,
  createSampleDefectsJsonl,
  InMemoryDefectStore,
} from "./defect-fixture.ts";

export const DEFECTS_SUITES = [
  "categorization-and-parsing",
  "lifecycle-and-resolution",
  "promotion-and-regression",
  "sync-state-machine",
  "sync-ledger-and-loop",
  "dedup-stream",
  "discriminator",
  "aggregator",
] as const;

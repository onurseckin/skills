/**
 * @file index.ts
 * Facade for tests/scheduler/topology/ test suite
 */

export const SCHEDULER_TOPOLOGY_SUITES = [
  "dynamic-topology-metrics.test.ts",
  "dynamic-topology-partitions.test.ts",
  "dynamic-topology.test.ts",
  "metrics.test.ts",
  "topology.test.ts",
  "unlimited-depth-critical-path.test.ts",
  "unlimited-depth-pairing.test.ts",
  "unlimited-depth-safety.test.ts",
  "unlimited-depth.test.ts",
] as const;

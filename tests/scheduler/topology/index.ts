export { SCHEDULER_TOPOLOGY_CORE_SUITES } from "./core/index.ts";
export { SCHEDULER_TOPOLOGY_DYNAMIC_SUITES } from "./dynamic/index.ts";
export { SCHEDULER_TOPOLOGY_UNLIMITED_SUITES } from "./unlimited/index.ts";

export const SCHEDULER_TOPOLOGY_SUITES = [
  "dynamic-topology-allocations.test.ts",
  "dynamic-topology-metrics-edge.test.ts",
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

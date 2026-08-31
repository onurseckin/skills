export { createSampleCapsuleSpecs, createSampleTaskSpecs } from "./fixture.ts";

export const CONCURRENCY_SUITES = [
  "concurrency-scaling",
  "false-serialization",
  "multi-capsule-execution",
  "multi-capsule-isolation",
  "topological-wave-decoupling",
  "topology-synthesis-graph",
  "topology-synthesis-waves",
] as const;

import type { RepoPolicy } from "../../../olt/scripts/src/policy/index.ts";

export function createTestPolicy(overrides?: Partial<RepoPolicy>): RepoPolicy {
  return {
    schema_version: "2.0.0",
    ecosystem: "bun",
    provenance: "auto_detected",
    enforcement_mode: "warn",
    task_size_tier: "medium",
    default_timeout_seconds: 300,
    max_subagents: 4,
    read_scope_neighborhood_depth: 3,
    concurrency_limits: {
      max_parallel_tasks: 4,
      max_concurrent_subagents: 4,
    },
    ...overrides,
  };
}

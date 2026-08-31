export { createTestPolicy } from "./fixture.ts";

export const POLICY_SUITES = [
  "policy-engine",
  "concurrency-cap",
  "subagent-pool-concurrency",
  "worktree",
  "worktree-isolation",
  "worktree-and-policy",
] as const;

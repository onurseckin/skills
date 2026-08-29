import {
  MAX_AGENTS,
  MAX_BRANCH_DEPTH,
  MAX_REPAIR_ROUNDS,
  MIN_ADVERSARIAL_PROBES,
} from "./contracts.ts";
import { deriveGateConcurrencyCeiling } from "./host-concurrency.ts";
import {
  buildConfigProvenanceMap,
  unattestedFact,
  type ConfigProvenanceMap,
  type TrackedConfigKey,
} from "./provenance.ts";
import type { HarnessConfig, ResolvedHarnessConfig } from "./contracts.ts";
import type { CanonicalHost, HostProfile } from "./host-canon.ts";
import type { AgentRole } from "../contracts/index.ts";

export const DEFAULT_CONFIG: HarnessConfig = {
  max_repair_rounds: MAX_REPAIR_ROUNDS,
  max_branch_depth: MAX_BRANCH_DEPTH,
  max_agents: MAX_AGENTS,
  max_output_bytes: 10 * 1024 * 1024,
  default_lease_seconds: 1800,
  default_max_parallel: 4,
  gate_max_parallel: deriveGateConcurrencyCeiling(),
  worktree_isolation: false,
  branch_prefix: "harness/",
  commit_per_subphase: true,
  max_commit_lines: 500,
  rebase_on_complete: true,
  supervisory_cadence_seconds: unattestedFact(900),
  quota_freeze_threshold_pct: unattestedFact<number | null>(null),
  host_profiles: unattestedFact<Partial<Record<CanonicalHost, HostProfile>>>({}),
  model_by_role: unattestedFact<Partial<Record<AgentRole, string>>>({}),
  fleet_agent_ceiling: unattestedFact<number | null>(null),
};

const DEFAULT_PROVENANCE: ConfigProvenanceMap = buildConfigProvenanceMap(
  null,
  null,
  new Set<TrackedConfigKey>(["gate_max_parallel"]),
  { default_max_parallel: "assumed_default" },
);

export const DEFAULT_RESOLVED_CONFIG: ResolvedHarnessConfig = {
  ...DEFAULT_CONFIG,
  min_adversarial_probes: MIN_ADVERSARIAL_PROBES,
  default_max_parallel_source: "assumed_default",
  max_active_grants_per_run: DEFAULT_CONFIG.max_agents,
  config_provenance: DEFAULT_PROVENANCE,
};

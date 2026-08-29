import type { AgentRole } from "../contracts/index.ts";
import type { CanonicalHost, HostProfile } from "./host-canon.ts";
import type {
  ConfigProvenanceMap,
  ExternallyAttestedFact,
  ExternallyAttestedSource,
} from "./provenance.ts";
import type { HostConcurrencyCeiling } from "./host-concurrency.ts";

export const QUOTA_FREEZE_THRESHOLD_FLOOR_PCT = 10;

export interface EffectiveQuotaThreshold {
  readonly value: number;
  readonly source: ExternallyAttestedSource;
}

export interface HarnessConfig {
  max_repair_rounds: number;
  max_branch_depth: number;
  max_agents: number;
  max_output_bytes: number;
  default_lease_seconds: number;
  default_max_parallel: number;
  max_concurrent_agents?: number;
  gate_max_parallel: number;
  worktree_isolation: boolean;
  worktree_root?: string;
  branch_prefix: string;
  commit_per_subphase: boolean;
  max_commit_lines: number;
  rebase_on_complete: boolean;
  supervisory_cadence_seconds: ExternallyAttestedFact<number>;
  quota_freeze_threshold_pct: ExternallyAttestedFact<number | null>;
  host_profiles: ExternallyAttestedFact<Partial<Record<CanonicalHost, HostProfile>>>;
  model_by_role: ExternallyAttestedFact<Partial<Record<AgentRole, string>>>;
  fleet_agent_ceiling: ExternallyAttestedFact<number | null>;
}

export type ConcurrencyCeilingSource = "config_override" | "host_discovered" | "assumed_default";

export interface ResolvedHarnessConfig extends HarnessConfig {
  min_adversarial_probes: number;
  default_max_parallel_source: ConcurrencyCeilingSource;
  max_active_grants_per_run: number;
  config_provenance: ConfigProvenanceMap;
}

export interface ResolveHarnessConfigOptions {
  readonly hostConcurrency?: HostConcurrencyCeiling | null;
  readonly cpuCount?: number;
}

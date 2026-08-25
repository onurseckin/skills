import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole } from "../contracts/packets.ts";
import { isAgentRole } from "../contracts/packets.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  MAX_AGENTS,
  MAX_BRANCH_DEPTH,
  MAX_REPAIR_ROUNDS,
  MIN_ADVERSARIAL_PROBES,
} from "./constants.ts";
import {
  deriveGateConcurrencyCeiling,
  discoverHostConcurrencyCeiling,
  type HostConcurrencyCeiling,
} from "./host-concurrency.ts";
import type { CanonicalHost, HostProfile } from "./host-canon.ts";
import { parseHostProfiles } from "./host-canon.ts";
import type {
  ConfigProvenanceMap,
  ExternallyAttestedFact,
  TrackedConfigKey,
} from "./provenance.ts";
import { attestedFact, buildConfigProvenanceMap, unattestedFact } from "./provenance.ts";

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

function positiveCount(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
}

function booleanField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function percentField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function modelByRoleField(value: unknown): Partial<Record<AgentRole, string>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Partial<Record<AgentRole, string>> = {};
  for (const [role, model] of Object.entries(record)) {
    if (isAgentRole(role) && typeof model === "string" && model.trim().length > 0) {
      result[role] = model;
    }
  }
  return result;
}

function fleetAgentCeilingField(value: unknown): ExternallyAttestedFact<number | null> | null {
  const count = positiveCount(value, 1);
  return count === null ? null : attestedFact<number | null>(count);
}

export function parseConfigFile(filePath: string): Partial<ResolvedHarnessConfig> | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessError("INTEGRITY", `${filePath} could not be read: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessError("INTEGRITY", `${filePath} is not valid JSON: ${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError(
      "INTEGRITY",
      `${filePath} must contain a JSON object at its root, found ${
        Array.isArray(parsed) ? "an array" : parsed === null ? "null" : typeof parsed
      }`,
    );
  }

  const record = parsed as Record<string, unknown>;
  const partial: Partial<ResolvedHarnessConfig> = {};

  const probes = positiveCount(record.min_adversarial_probes, 0);
  if (probes !== null) partial.min_adversarial_probes = probes;

  const repairRounds = positiveCount(record.max_repair_rounds, 1);
  if (repairRounds !== null) partial.max_repair_rounds = repairRounds;

  const branchDepth = positiveCount(record.max_branch_depth, 1);
  if (branchDepth !== null) partial.max_branch_depth = branchDepth;

  const agentBudget = positiveCount(record.max_agents, 1);
  if (agentBudget !== null) partial.max_agents = agentBudget;

  const outputBytes = positiveCount(record.max_output_bytes, 1024);
  if (outputBytes !== null) partial.max_output_bytes = outputBytes;

  const leaseSeconds = positiveCount(record.default_lease_seconds, 5);
  if (leaseSeconds !== null && leaseSeconds <= 86_400) {
    partial.default_lease_seconds = leaseSeconds;
  }

  const maxParallel = positiveCount(record.default_max_parallel, 1);
  if (maxParallel !== null) partial.default_max_parallel = maxParallel;

  const concurrentAgents = positiveCount(record.max_concurrent_agents, 1);
  if (concurrentAgents !== null) partial.max_concurrent_agents = concurrentAgents;

  const gateMaxParallel = positiveCount(record.gate_max_parallel, 1);
  if (gateMaxParallel !== null) partial.gate_max_parallel = gateMaxParallel;

  const worktreeIsolation = booleanField(record.worktree_isolation);
  if (worktreeIsolation !== null) partial.worktree_isolation = worktreeIsolation;

  const worktreeRoot = textField(record.worktree_root);
  if (worktreeRoot !== null) partial.worktree_root = worktreeRoot;

  const branchPrefix = textField(record.branch_prefix);
  if (branchPrefix !== null) partial.branch_prefix = branchPrefix;

  const commitPerSubphase = booleanField(record.commit_per_subphase);
  if (commitPerSubphase !== null) partial.commit_per_subphase = commitPerSubphase;

  const maxCommitLines = positiveCount(record.max_commit_lines, 1);
  if (maxCommitLines !== null) partial.max_commit_lines = maxCommitLines;

  const rebaseOnComplete = booleanField(record.rebase_on_complete);
  if (rebaseOnComplete !== null) partial.rebase_on_complete = rebaseOnComplete;

  const supervisoryCadenceSeconds = positiveCount(record.supervisory_cadence_seconds, 1);
  if (supervisoryCadenceSeconds !== null) {
    partial.supervisory_cadence_seconds = attestedFact(supervisoryCadenceSeconds);
  }

  const quotaFreezeThresholdPct = percentField(record.quota_freeze_threshold_pct);
  if (quotaFreezeThresholdPct !== null) {
    partial.quota_freeze_threshold_pct = attestedFact<number | null>(quotaFreezeThresholdPct);
  }

  if (record.host_profiles !== undefined) {
    partial.host_profiles = attestedFact(parseHostProfiles(record.host_profiles, filePath));
  }

  const modelByRole = modelByRoleField(record.model_by_role);
  if (modelByRole !== null) partial.model_by_role = attestedFact(modelByRole);

  const fleetAgentCeiling = fleetAgentCeilingField(record.fleet_agent_ceiling);
  if (fleetAgentCeiling !== null) partial.fleet_agent_ceiling = fleetAgentCeiling;

  return partial;
}

function resolveConcurrencyCeiling(
  capsuleConfig: Partial<ResolvedHarnessConfig> | null,
  repoConfig: Partial<ResolvedHarnessConfig> | null,
  discovery: HostConcurrencyCeiling | null,
): Pick<ResolvedHarnessConfig, "default_max_parallel" | "default_max_parallel_source"> {
  let explicitParallel: number | undefined;
  if (repoConfig?.default_max_parallel !== undefined) {
    explicitParallel = repoConfig.default_max_parallel;
  } else if (capsuleConfig?.default_max_parallel !== undefined) {
    explicitParallel = capsuleConfig.default_max_parallel;
  } else {
    explicitParallel = undefined;
  }
  if (explicitParallel !== undefined) {
    return {
      default_max_parallel: explicitParallel,
      default_max_parallel_source: "config_override",
    };
  }
  let explicitCeiling: number | undefined;
  if (repoConfig?.max_concurrent_agents !== undefined) {
    explicitCeiling = repoConfig.max_concurrent_agents;
  } else if (capsuleConfig?.max_concurrent_agents !== undefined) {
    explicitCeiling = capsuleConfig.max_concurrent_agents;
  } else {
    explicitCeiling = undefined;
  }
  if (explicitCeiling !== undefined) {
    return {
      default_max_parallel: explicitCeiling,
      default_max_parallel_source: "config_override",
    };
  }
  if (discovery !== null) {
    return {
      default_max_parallel: discovery.value,
      default_max_parallel_source: "host_discovered",
    };
  }
  return {
    default_max_parallel: DEFAULT_CONFIG.default_max_parallel,
    default_max_parallel_source: "assumed_default",
  };
}

export interface ResolveHarnessConfigOptions {
  readonly hostConcurrency?: HostConcurrencyCeiling | null;
  readonly cpuCount?: number;
}

export function resolveHarnessConfig(
  repoRoot?: string,
  capsuleRoot?: string,
  options?: ResolveHarnessConfigOptions,
): ResolvedHarnessConfig {
  let root: string;
  if (repoRoot !== undefined) {
    root = repoRoot;
  } else {
    root = process.cwd();
  }
  let repoConfig: Partial<ResolvedHarnessConfig> | null = null;
  const standardRepo = join(root, "harness.config.json");
  const dotRepo = join(root, ".harness.config.json");

  if (existsSync(standardRepo)) {
    repoConfig = parseConfigFile(standardRepo);
  } else if (existsSync(dotRepo)) {
    repoConfig = parseConfigFile(dotRepo);
  }

  let capsuleConfig: Partial<ResolvedHarnessConfig> | null = null;
  if (capsuleRoot) {
    const standardCap = join(capsuleRoot, "config.json");
    const harnessCap = join(capsuleRoot, "harness.config.json");
    if (existsSync(standardCap)) {
      capsuleConfig = parseConfigFile(standardCap);
    } else if (existsSync(harnessCap)) {
      capsuleConfig = parseConfigFile(harnessCap);
    }
  }

  const discovery =
    options?.hostConcurrency !== undefined
      ? options.hostConcurrency
      : discoverHostConcurrencyCeiling();
  const concurrency = resolveConcurrencyCeiling(capsuleConfig, repoConfig, discovery);
  let gateMaxParallel: number;
  if (repoConfig?.gate_max_parallel !== undefined) {
    gateMaxParallel = repoConfig.gate_max_parallel;
  } else if (capsuleConfig?.gate_max_parallel !== undefined) {
    gateMaxParallel = capsuleConfig.gate_max_parallel;
  } else {
    gateMaxParallel = deriveGateConcurrencyCeiling(options?.cpuCount);
  }

  const hostDiscoveredKeys = new Set<TrackedConfigKey>(["gate_max_parallel"]);
  const provenance = buildConfigProvenanceMap(capsuleConfig, repoConfig, hostDiscoveredKeys, {
    default_max_parallel: concurrency.default_max_parallel_source,
  });

  let capsuleConfigForMerge: Partial<ResolvedHarnessConfig>;
  if (capsuleConfig !== null) {
    capsuleConfigForMerge = capsuleConfig;
  } else {
    capsuleConfigForMerge = {};
  }
  let repoConfigForMerge: Partial<ResolvedHarnessConfig>;
  if (repoConfig !== null) {
    repoConfigForMerge = repoConfig;
  } else {
    repoConfigForMerge = {};
  }
  const merged: ResolvedHarnessConfig = {
    ...DEFAULT_RESOLVED_CONFIG,
    ...capsuleConfigForMerge,
    ...repoConfigForMerge,
    ...concurrency,
    gate_max_parallel: gateMaxParallel,
    config_provenance: provenance,
  };

  return {
    ...merged,
    max_active_grants_per_run: merged.max_agents,
    config_provenance: {
      ...merged.config_provenance,
      max_active_grants_per_run: merged.config_provenance.max_agents,
    },
  };
}

const resolvedCache = new Map<string, Readonly<ResolvedHarnessConfig>>();

function cacheKey(repoRoot: string, capsuleRoot: string | undefined): string {
  let capsuleKeyPart: string;
  if (capsuleRoot !== undefined) {
    capsuleKeyPart = capsuleRoot;
  } else {
    capsuleKeyPart = "";
  }
  return `${repoRoot}\u0000${capsuleKeyPart}`;
}

export function getHarnessConfig(
  repoRoot?: string,
  capsuleRoot?: string,
): Readonly<ResolvedHarnessConfig> {
  let effectiveRepoRoot: string;
  if (repoRoot !== undefined) {
    effectiveRepoRoot = repoRoot;
  } else {
    effectiveRepoRoot = process.cwd();
  }
  const key = cacheKey(effectiveRepoRoot, capsuleRoot);
  const cached = resolvedCache.get(key);
  if (cached) return cached;
  const resolved = Object.freeze(resolveHarnessConfig(repoRoot, capsuleRoot));
  resolvedCache.set(key, resolved);
  return resolved;
}

export function resetHarnessConfigCache(): void {
  resolvedCache.clear();
}

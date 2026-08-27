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
import { resolvePolicyPath } from "../shared/paths.ts";
import type {
  ConfigProvenanceMap,
  ConfigValueSource,
  ExternallyAttestedFact,
  ExternallyAttestedSource,
  TrackedConfigKey,
} from "./provenance.ts";
import {
  attestedFact,
  buildConfigProvenanceMap,
  unattestedFact,
  unreadableFact,
} from "./provenance.ts";

export const QUOTA_FREEZE_THRESHOLD_FLOOR_PCT = 10;

export interface EffectiveQuotaThreshold {
  readonly value: number;
  readonly source: ExternallyAttestedSource;
}

export function resolveEffectiveQuotaThreshold(
  fact: ExternallyAttestedFact<number | null>,
): EffectiveQuotaThreshold {
  if (fact.source === "config_override" && typeof fact.value === "number") {
    return { value: fact.value, source: fact.source };
  }
  return { value: QUOTA_FREEZE_THRESHOLD_FLOOR_PCT, source: fact.source };
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
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
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
    if (!isAgentRole(role) || typeof model !== "string" || model.trim().length === 0) return null;
    result[role] = model;
  }
  return result;
}

function fleetAgentCeilingField(value: unknown): ExternallyAttestedFact<number | null> | null {
  const count = positiveCount(value, 1);
  return count === null ? null : attestedFact<number | null>(count);
}

const HARNESS_CONFIG_KEYS = new Set<string>([
  "min_adversarial_probes",
  "max_repair_rounds",
  "max_branch_depth",
  "max_agents",
  "max_output_bytes",
  "default_lease_seconds",
  "default_max_parallel",
  "max_concurrent_agents",
  "gate_max_parallel",
  "worktree_isolation",
  "worktree_root",
  "branch_prefix",
  "commit_per_subphase",
  "max_commit_lines",
  "rebase_on_complete",
  "supervisory_cadence_seconds",
  "quota_freeze_threshold_pct",
  "host_profiles",
  "model_by_role",
  "fleet_agent_ceiling",
]);

function safeCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string")
      return descriptor.value.slice(0, 240);
  } catch {
    // Retain a generic cause when an untrusted object rejects inspection.
  }
  return "unknown error";
}

function invalidConfig(filePath: string, key: string, reason: string): never {
  throw new HarnessError("INTEGRITY", `${filePath} config key '${key}' ${reason}`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function parseConfigFile(filePath: string): Partial<ResolvedHarnessConfig> | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${filePath} could not be read: ${safeCause(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${filePath} is not valid JSON: ${safeCause(error)}`);
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

  for (const key of Object.keys(record)) {
    if (!HARNESS_CONFIG_KEYS.has(key)) invalidConfig(filePath, key, "is not supported");
  }
  const count = (key: string, minimum: number): number | undefined => {
    if (!hasOwn(record, key)) return undefined;
    const value = positiveCount(record[key], minimum);
    return value === null
      ? invalidConfig(filePath, key, `must be a safe integer >= ${minimum}`)
      : value;
  };
  const probes = count("min_adversarial_probes", 0);
  if (probes !== undefined) partial.min_adversarial_probes = probes;
  const repairRounds = count("max_repair_rounds", 1);
  if (repairRounds !== undefined) partial.max_repair_rounds = repairRounds;
  const branchDepth = count("max_branch_depth", 1);
  if (branchDepth !== undefined) partial.max_branch_depth = branchDepth;
  const agentBudget = count("max_agents", 1);
  if (agentBudget !== undefined) partial.max_agents = agentBudget;
  const outputBytes = count("max_output_bytes", 1024);
  if (outputBytes !== undefined) partial.max_output_bytes = outputBytes;
  const leaseSeconds = count("default_lease_seconds", 5);
  if (leaseSeconds !== undefined) {
    if (leaseSeconds > 86_400) invalidConfig(filePath, "default_lease_seconds", "must be <= 86400");
    partial.default_lease_seconds = leaseSeconds;
  }
  const maxParallel = count("default_max_parallel", 1);
  if (maxParallel !== undefined) partial.default_max_parallel = maxParallel;
  const concurrentAgents = count("max_concurrent_agents", 1);
  if (concurrentAgents !== undefined) partial.max_concurrent_agents = concurrentAgents;
  const gateMaxParallel = count("gate_max_parallel", 1);
  if (gateMaxParallel !== undefined) partial.gate_max_parallel = gateMaxParallel;
  const maxCommitLines = count("max_commit_lines", 1);
  if (maxCommitLines !== undefined) partial.max_commit_lines = maxCommitLines;
  const supervisoryCadenceSeconds = count("supervisory_cadence_seconds", 1);
  if (supervisoryCadenceSeconds !== undefined)
    partial.supervisory_cadence_seconds = attestedFact(supervisoryCadenceSeconds);

  for (const key of ["worktree_isolation", "commit_per_subphase", "rebase_on_complete"] as const) {
    if (!hasOwn(record, key)) continue;
    const value = booleanField(record[key]);
    if (value === null) invalidConfig(filePath, key, "must be a boolean");
    partial[key] = value;
  }
  for (const key of ["worktree_root", "branch_prefix"] as const) {
    if (!hasOwn(record, key)) continue;
    const value = textField(record[key]);
    if (value === null) invalidConfig(filePath, key, "must be a non-empty string");
    partial[key] = value;
  }
  if (hasOwn(record, "quota_freeze_threshold_pct")) {
    const value = percentField(record.quota_freeze_threshold_pct);
    if (value === null)
      invalidConfig(
        filePath,
        "quota_freeze_threshold_pct",
        "must be a finite percentage from zero to one hundred",
      );
    partial.quota_freeze_threshold_pct = attestedFact<number | null>(value);
  }
  if (hasOwn(record, "host_profiles")) {
    try {
      partial.host_profiles = attestedFact(parseHostProfiles(record.host_profiles, filePath));
    } catch (error) {
      invalidConfig(filePath, "host_profiles", `is invalid: ${safeCause(error)}`);
    }
  }
  if (hasOwn(record, "model_by_role")) {
    const value = modelByRoleField(record.model_by_role);
    if (value === null)
      invalidConfig(
        filePath,
        "model_by_role",
        "must map only known roles to non-empty model names",
      );
    partial.model_by_role = attestedFact(value);
  }
  if (hasOwn(record, "fleet_agent_ceiling")) {
    const value = fleetAgentCeilingField(record.fleet_agent_ceiling);
    if (value === null)
      invalidConfig(filePath, "fleet_agent_ceiling", "must be a safe integer >= 1");
    partial.fleet_agent_ceiling = value;
  }

  return partial;
}

function parsePolicyLayer(policyPath: string): Partial<ResolvedHarnessConfig> | null {
  if (!existsSync(policyPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(policyPath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { quota_freeze_threshold_pct: unreadableFact<number | null>(null) };
    }
    const record = parsed as Record<string, unknown>;
    if (!hasOwn(record, "quota_freeze_threshold_pct")) return null;
    const threshold = percentField(record.quota_freeze_threshold_pct);
    if (threshold === null)
      return { quota_freeze_threshold_pct: unreadableFact<number | null>(null) };
    return { quota_freeze_threshold_pct: attestedFact<number | null>(threshold) };
  } catch {
    return { quota_freeze_threshold_pct: unreadableFact<number | null>(null) };
  }
}

function quotaProvenanceSource(fact: ExternallyAttestedFact<number | null>): ConfigValueSource {
  if (fact.source === "config_override") return "config_override";
  if (fact.source === "unreadable") return "unreadable";
  return "assumed_default";
}

function resolveQuotaFreezeThresholdFact(
  policyConfig: Partial<ResolvedHarnessConfig> | null,
  capsuleConfig: Partial<ResolvedHarnessConfig> | null,
  repoConfig: Partial<ResolvedHarnessConfig> | null,
): ExternallyAttestedFact<number | null> {
  if (repoConfig?.quota_freeze_threshold_pct !== undefined) {
    return repoConfig.quota_freeze_threshold_pct;
  }
  if (capsuleConfig?.quota_freeze_threshold_pct !== undefined) {
    return capsuleConfig.quota_freeze_threshold_pct;
  }
  if (policyConfig?.quota_freeze_threshold_pct !== undefined) {
    return policyConfig.quota_freeze_threshold_pct;
  }
  return DEFAULT_CONFIG.quota_freeze_threshold_pct;
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

  const policyConfig = parsePolicyLayer(resolvePolicyPath(root));
  const quotaFact = resolveQuotaFreezeThresholdFact(policyConfig, capsuleConfig, repoConfig);

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
    quota_freeze_threshold_pct: quotaProvenanceSource(quotaFact),
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
    quota_freeze_threshold_pct: quotaFact,
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

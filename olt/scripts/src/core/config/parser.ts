import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../errors/index.ts";
import { parseHostProfiles } from "./host-canon.ts";
import { attestedFact, unreadableFact } from "./provenance.ts";
import type { ResolvedHarnessConfig } from "./contracts.ts";
import {
  booleanField,
  fleetAgentCeilingField,
  hasOwn,
  invalidConfig,
  modelByRoleField,
  percentField,
  positiveCount,
  safeCause,
  textField,
} from "./validator.ts";

export const HARNESS_CONFIG_KEYS = new Set<string>([
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

export function parsePolicyLayer(policyPath: string): Partial<ResolvedHarnessConfig> | null {
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

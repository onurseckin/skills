import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePolicyPath } from "../shared/paths.ts";
import {
  deriveGateConcurrencyCeiling,
  discoverHostConcurrencyCeiling,
  type HostConcurrencyCeiling,
} from "./host-concurrency.ts";
import {
  buildConfigProvenanceMap,
  type ConfigValueSource,
  type ExternallyAttestedFact,
  type TrackedConfigKey,
} from "./provenance.ts";
import type { ResolvedHarnessConfig, ResolveHarnessConfigOptions } from "./contracts.ts";
import { DEFAULT_CONFIG, DEFAULT_RESOLVED_CONFIG } from "./defaults.ts";
import { parseConfigFile, parsePolicyLayer } from "./parser.ts";

export function quotaProvenanceSource(
  fact: ExternallyAttestedFact<number | null>,
): ConfigValueSource {
  if (fact.source === "config_override") return "config_override";
  if (fact.source === "unreadable") return "unreadable";
  return "assumed_default";
}

export function resolveQuotaFreezeThresholdFact(
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

export function resolveConcurrencyCeiling(
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

export function cacheKey(repoRoot: string, capsuleRoot: string | undefined): string {
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

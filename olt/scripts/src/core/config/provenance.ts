export const CONFIG_VALUE_SOURCES = [
  "config_override",
  "host_discovered",
  "assumed_default",
  "unreadable",
] as const;

export type ConfigValueSource = (typeof CONFIG_VALUE_SOURCES)[number];

export function isConfigValueSource(value: unknown): value is ConfigValueSource {
  return typeof value === "string" && (CONFIG_VALUE_SOURCES as readonly string[]).includes(value);
}

export type ExternallyAttestedSource = "config_override" | "absent" | "unreadable";

export interface ExternallyAttestedFact<T> {
  readonly value: T;
  readonly source: ExternallyAttestedSource;
}

export function unattestedFact<T>(absentValue: T): ExternallyAttestedFact<T> {
  return { value: absentValue, source: "absent" };
}

export function unreadableFact<T>(fallbackValue: T): ExternallyAttestedFact<T> {
  return { value: fallbackValue, source: "unreadable" };
}

export function attestedFact<T>(value: T): ExternallyAttestedFact<T> {
  return { value, source: "config_override" };
}

export const TRACKED_CONFIG_KEYS = [
  "max_repair_rounds",
  "max_branch_depth",
  "max_agents",
  "max_active_grants_per_run",
  "max_output_bytes",
  "default_lease_seconds",
  "default_max_parallel",
  "gate_max_parallel",
  "worktree_isolation",
  "worktree_root",
  "branch_prefix",
  "commit_per_subphase",
  "max_commit_lines",
  "rebase_on_complete",
  "min_adversarial_probes",
  "supervisory_cadence_seconds",
  "quota_freeze_threshold_pct",
  "host_profiles",
  "model_by_role",
] as const;

export type TrackedConfigKey = (typeof TRACKED_CONFIG_KEYS)[number];

export type ConfigProvenanceMap = Readonly<Record<TrackedConfigKey, ConfigValueSource>>;

export function buildConfigProvenanceMap(
  capsuleConfig: Readonly<Partial<Record<TrackedConfigKey, unknown>>> | null,
  repoConfig: Readonly<Partial<Record<TrackedConfigKey, unknown>>> | null,
  hostDiscoveredKeys: ReadonlySet<TrackedConfigKey>,
  resolvedSources: Readonly<Partial<Record<TrackedConfigKey, ConfigValueSource>>> = {},
): ConfigProvenanceMap {
  const map = {} as Record<TrackedConfigKey, ConfigValueSource>;
  for (const key of TRACKED_CONFIG_KEYS) {
    const resolved = resolvedSources[key];
    if (resolved !== undefined) {
      map[key] = resolved;
    } else if (repoConfig !== null && key in repoConfig) {
      map[key] = "config_override";
    } else if (capsuleConfig !== null && key in capsuleConfig) {
      map[key] = "config_override";
    } else if (hostDiscoveredKeys.has(key)) {
      map[key] = "host_discovered";
    } else {
      map[key] = "assumed_default";
    }
  }
  return map;
}

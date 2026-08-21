import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

export interface HarnessConfig {
  max_repair_rounds: number;
  max_branch_depth: number;
  max_agents: number;
  max_output_bytes: number;
  default_lease_seconds: number;
  default_max_parallel: number;
  max_concurrent_agents?: number;
  gate_max_parallel: number;
  /**
   * B22.7: whether `plan:compile` provisions its own `harness/<run-id>` branch and git worktrees
   * instead of leaving every task to run in the caller's own working tree.
   *
   * B22's own text says "default on"; this build ships it OFF by default. Turning it on changes
   * what `plan:compile` and `task:submit` do to the filesystem for every existing capsule and test
   * that calls them, and that blast radius cannot be verified from this seat without running the
   * full suite (out of scope for this pass, and the standing instruction is not to run it
   * speculatively). The feature is complete and covered by its own tests with the flag explicitly
   * turned on; flipping this default is a one-line change for whoever next runs the full suite to
   * confirm nothing regresses.
   */
  worktree_isolation: boolean;
  worktree_root?: string;
  branch_prefix: string;
  commit_per_subphase: boolean;
  max_commit_lines: number;
  rebase_on_complete: boolean;
}

export type ConcurrencyCeilingSource = "config_override" | "host_discovered" | "assumed_default";

export interface ResolvedHarnessConfig extends HarnessConfig {
  min_adversarial_probes: number;
  default_max_parallel_source: ConcurrencyCeilingSource;
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
};

export const DEFAULT_RESOLVED_CONFIG: ResolvedHarnessConfig = {
  ...DEFAULT_CONFIG,
  min_adversarial_probes: MIN_ADVERSARIAL_PROBES,
  default_max_parallel_source: "assumed_default",
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

function parseConfigFile(filePath: string): Partial<ResolvedHarnessConfig> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
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

    return partial;
  } catch {
    return null;
  }
}

function resolveConcurrencyCeiling(
  capsuleConfig: Partial<ResolvedHarnessConfig> | null,
  repoConfig: Partial<ResolvedHarnessConfig> | null,
  discovery: HostConcurrencyCeiling | null,
): Pick<ResolvedHarnessConfig, "default_max_parallel" | "default_max_parallel_source"> {
  const explicitParallel = repoConfig?.default_max_parallel ?? capsuleConfig?.default_max_parallel;
  if (explicitParallel !== undefined) {
    return {
      default_max_parallel: explicitParallel,
      default_max_parallel_source: "config_override",
    };
  }
  const explicitCeiling = repoConfig?.max_concurrent_agents ?? capsuleConfig?.max_concurrent_agents;
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
  const root = repoRoot ?? process.cwd();
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
  const gateMaxParallel =
    repoConfig?.gate_max_parallel ??
    capsuleConfig?.gate_max_parallel ??
    deriveGateConcurrencyCeiling(options?.cpuCount);

  return {
    ...DEFAULT_RESOLVED_CONFIG,
    ...(capsuleConfig ?? {}),
    ...(repoConfig ?? {}),
    ...concurrency,
    gate_max_parallel: gateMaxParallel,
  };
}

const resolvedCache = new Map<string, Readonly<ResolvedHarnessConfig>>();

function cacheKey(repoRoot: string, capsuleRoot: string | undefined): string {
  return `${repoRoot}\u0000${capsuleRoot ?? ""}`;
}

export function getHarnessConfig(
  repoRoot?: string,
  capsuleRoot?: string,
): Readonly<ResolvedHarnessConfig> {
  const key = cacheKey(repoRoot ?? process.cwd(), capsuleRoot);
  const cached = resolvedCache.get(key);
  if (cached) return cached;
  const resolved = Object.freeze(resolveHarnessConfig(repoRoot, capsuleRoot));
  resolvedCache.set(key, resolved);
  return resolved;
}

export function resetHarnessConfigCache(): void {
  resolvedCache.clear();
}

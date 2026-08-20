import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_AGENTS,
  MAX_BRANCH_DEPTH,
  MAX_REPAIR_ROUNDS,
  MIN_ADVERSARIAL_PROBES,
} from "./constants.ts";

export interface HarnessConfig {
  max_repair_rounds: number;
  /**
   * Escalation tripwire on branch nesting. Chains terminate because every branch must strictly
   * narrow its parent's write scope, so this number bounds nothing structural: it is the depth past
   * which subdividing reads as a mis-scoped task that a human should look at.
   */
  max_branch_depth: number;
  /** Total agent grants a run may issue, counted across every depth of the lineage. */
  max_agents: number;
  max_output_bytes: number;
  default_lease_seconds: number;
  default_max_parallel: number;
}

export interface ResolvedHarnessConfig extends HarnessConfig {
  min_adversarial_probes: number;
}

export const DEFAULT_CONFIG: HarnessConfig = {
  max_repair_rounds: MAX_REPAIR_ROUNDS,
  max_branch_depth: MAX_BRANCH_DEPTH,
  max_agents: MAX_AGENTS,
  max_output_bytes: 10 * 1024 * 1024,
  default_lease_seconds: 1800,
  default_max_parallel: 4,
};

export const DEFAULT_RESOLVED_CONFIG: ResolvedHarnessConfig = {
  ...DEFAULT_CONFIG,
  min_adversarial_probes: MIN_ADVERSARIAL_PROBES,
};

function positiveCount(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
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

    return partial;
  } catch {
    return null;
  }
}

export function resolveHarnessConfig(
  repoRoot?: string,
  capsuleRoot?: string,
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

  return {
    ...DEFAULT_RESOLVED_CONFIG,
    ...(capsuleConfig ?? {}),
    ...(repoConfig ?? {}),
  };
}

const resolvedCache = new Map<string, Readonly<ResolvedHarnessConfig>>();

function cacheKey(repoRoot: string, capsuleRoot: string | undefined): string {
  return `${repoRoot}\u0000${capsuleRoot ?? ""}`;
}

/**
 * Command-path accessor: config lives on disk but is read once per root pair, so call sites can ask
 * for a knob wherever they need it instead of threading a config object through every signature.
 * Frozen because the cached instance is shared.
 */
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

import { normalizeRoleKey } from "../../authority/host-bindings.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { detectActiveHost, isHostType, type HostType } from "../../platform/host-autodetect.ts";
import {
  generateDefaultRepoPolicy,
  loadRepoPolicy,
  type AgentSchedulerPolicy,
  type RepoPolicy,
} from "../../policy/index.ts";

export const DEFAULT_HOST_INTERVAL_SECONDS: Readonly<Record<HostType, number>> = {
  antigravity: 300,
  claude_code: 900,
  codex: 900,
  cursor: 300,
};

export function resolveAgentSchedulerConfig(
  role: string,
  host?: HostType,
  policy?: RepoPolicy,
  repoRoot?: string,
): AgentSchedulerPolicy {
  if (typeof role !== "string" || role.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Role name must be a non-empty string");
  }

  const activePolicy = policy ?? loadRepoPolicy(repoRoot);
  const normalizedKey = normalizeRoleKey(role);
  const trimmedRole = role.trim();

  let agentPolicy = activePolicy.agents?.[normalizedKey] ?? activePolicy.agents?.[trimmedRole];

  if (!agentPolicy && activePolicy.agents === undefined) {
    const defaultPolicy = generateDefaultRepoPolicy(repoRoot);
    agentPolicy = defaultPolicy.agents?.[normalizedKey] ?? defaultPolicy.agents?.[trimmedRole];
  }

  if (!agentPolicy) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Cannot resolve agent role '${role}' (normalized key: '${normalizedKey}') in repository policy`,
    );
  }

  const targetHost: HostType = host !== undefined ? host : detectActiveHost();
  if (!isHostType(targetHost)) {
    throw new HarnessError("INVALID_ARGUMENT", `Invalid host type '${String(targetHost)}'`);
  }

  const hostConfig = agentPolicy.hosts?.[targetHost];
  if (!hostConfig) {
    throw new HarnessError(
      "INTEGRITY",
      `Missing host configuration for role '${role}' (normalized: '${normalizedKey}') on host '${targetHost}'`,
    );
  }

  if (hostConfig.scheduler) {
    return hostConfig.scheduler;
  }

  return {
    enabled: false,
    interval_seconds: DEFAULT_HOST_INTERVAL_SECONDS[targetHost],
  };
}

export function resolveSchedulerIntervalSeconds(
  role: string,
  host?: HostType,
  policy?: RepoPolicy,
  repoRoot?: string,
): number {
  const targetHost: HostType = host !== undefined ? host : detectActiveHost();
  const config = resolveAgentSchedulerConfig(role, targetHost, policy, repoRoot);
  return config.interval_seconds ?? DEFAULT_HOST_INTERVAL_SECONDS[targetHost];
}

export function resolveSchedulerCron(
  role: string,
  host?: HostType,
  policy?: RepoPolicy,
  repoRoot?: string,
): string | undefined {
  const config = resolveAgentSchedulerConfig(role, host, policy, repoRoot);
  return config.cron;
}

export function isSchedulerEnabled(
  role: string,
  host?: HostType,
  policy?: RepoPolicy,
  repoRoot?: string,
): boolean {
  const config = resolveAgentSchedulerConfig(role, host, policy, repoRoot);
  return config.enabled;
}

export interface QuotaAwareCadenceOptions {
  readonly role: string;
  readonly host?: HostType | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly repoRoot?: string | undefined;
  readonly quotaPercentage?: number | null | undefined;
  readonly isTriggered?: boolean | undefined;
}

export function resolveQuotaAwareSchedulerIntervalSeconds(
  options: QuotaAwareCadenceOptions,
): number {
  const baseInterval = resolveSchedulerIntervalSeconds(
    options.role,
    options.host,
    options.policy,
    options.repoRoot,
  );
  if (
    options.isTriggered === true ||
    (typeof options.quotaPercentage === "number" && options.quotaPercentage <= 10)
  ) {
    return Math.max(baseInterval, 900);
  }
  return baseInterval;
}

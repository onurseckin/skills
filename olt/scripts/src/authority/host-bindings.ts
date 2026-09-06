import { HarnessError } from "../core/errors/index.ts";
import { detectActiveHost, isHostType, type HostType } from "../platform/host-autodetect.ts";
import { generateDefaultRepoPolicy } from "../policy/generator/index.ts";
import { loadRepoPolicy } from "../policy/repo-policy.ts";
import type { AgentHostPolicy, RepoPolicy } from "../policy/types/index.ts";

export function normalizeRoleKey(role: string): string {
  if (typeof role !== "string") {
    return "";
  }
  return role.trim().toLowerCase().replace(/-/g, "_");
}

export function resolveAgentHostConfiguration(
  role: string,
  host?: HostType,
  policy?: RepoPolicy,
  repoRoot?: string,
): AgentHostPolicy {
  if (typeof role !== "string" || role.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "Role name must be a non-empty string");
  }

  const activePolicy = policy ?? loadRepoPolicy(repoRoot);
  const normalizedKey = normalizeRoleKey(role);
  const trimmedRole = role.trim();

  let agentPolicy =
    activePolicy.agents?.[normalizedKey] ??
    activePolicy.agents?.[trimmedRole] ??
    (normalizedKey === "mind" ? activePolicy.agents?.["mind_supervisor"] : undefined) ??
    (normalizedKey === "mind_supervisor" ? activePolicy.agents?.["mind"] : undefined);

  if (!agentPolicy && activePolicy.agents === undefined) {
    const defaultPolicy = generateDefaultRepoPolicy(repoRoot);
    agentPolicy =
      defaultPolicy.agents?.[normalizedKey] ??
      defaultPolicy.agents?.[trimmedRole] ??
      (normalizedKey === "mind" ? defaultPolicy.agents?.["mind_supervisor"] : undefined) ??
      (normalizedKey === "mind_supervisor" ? defaultPolicy.agents?.["mind"] : undefined);
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

  return hostConfig;
}

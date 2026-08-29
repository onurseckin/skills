import { HarnessError } from "../core/errors/index.ts";
import { detectActiveHost, isHostType, type HostType } from "../platform/host-autodetect.ts";
import { generateDefaultRepoPolicy } from "../policy/generator/index.ts";
import { loadRepoPolicy } from "../policy/repo-policy.ts";
import type { AgentHostPolicy, RepoPolicy } from "../policy/types/index.ts";

export const ROLE_KEY_ALIASES: Readonly<Record<string, string>> = {
  // Mind / Tier 0
  mind: "mind_supervisor",
  "mind-supervisor": "mind_supervisor",
  mind_supervisor: "mind_supervisor",
  "tier-0": "mind_supervisor",
  tier_0: "mind_supervisor",
  "tier 0": "mind_supervisor",
  human: "mind_supervisor",
  "mind-auditor": "mind_auditor",
  mind_auditor: "mind_auditor",
  "skill-auditor": "skill_auditor",
  skill_auditor: "skill_auditor",
  "meta-auditor": "skill_auditor",
  meta_auditor: "skill_auditor",
  "autonomic-watchdog": "autonomic_watchdog",
  autonomic_watchdog: "autonomic_watchdog",
  watchdog: "autonomic_watchdog",

  // Orchestrator / Tier 1
  orchestrator: "orchestrator",
  orch: "orchestrator",
  "tier-1": "orchestrator",
  tier_1: "orchestrator",
  "tier 1": "orchestrator",
  planner: "orchestrator",
  "independent-planner": "orchestrator",

  // Coordinator / Tier 2
  coordinator: "coordinator",
  coord: "coordinator",
  "tier-2": "coordinator",
  tier_2: "coordinator",
  "tier 2": "coordinator",

  // Implementer / Worker / Repairer / Tier 3
  implementer: "implementer",
  worker: "implementer",
  repairer: "implementer",
  "sub-implementer": "implementer",
  sub_implementer: "implementer",
  "sub-investigator": "implementer",
  sub_investigator: "implementer",
  "tier-3": "implementer",
  tier_3: "implementer",
  "tier 3": "implementer",

  // Validators
  validator: "validator_code_quality",
  "validator-code-quality": "validator_code_quality",
  validator_code_quality: "validator_code_quality",
  "mechanic-validator": "validator_code_quality",
  mechanic_validator: "validator_code_quality",
  "sub-validator": "validator_code_quality",
  sub_validator: "validator_code_quality",

  "validator-ui-design": "validator_ui_design",
  validator_ui_design: "validator_ui_design",
  "ui-validator": "validator_ui_design",
  ui_validator: "validator_ui_design",
  "ui-mechanic-validator": "validator_ui_design",
  ui_mechanic_validator: "validator_ui_design",

  "validator-security": "validator_security",
  validator_security: "validator_security",

  "validator-system-design": "validator_system_design",
  validator_system_design: "validator_system_design",
  "plan-validator": "validator_system_design",
  plan_validator: "validator_system_design",

  "validator-product": "validator_product",
  validator_product: "validator_product",

  "independent-planner-audit": "skill_auditor",

  // Critic
  "completeness-critic": "completeness_critic",
  completeness_critic: "completeness_critic",
  critic: "completeness_critic",

  // Owner
  owner: "owner",
};

export function normalizeRoleKey(role: string): string {
  if (typeof role !== "string") {
    return "";
  }
  const trimmed = role.trim().toLowerCase();
  if (ROLE_KEY_ALIASES[trimmed]) {
    return ROLE_KEY_ALIASES[trimmed];
  }
  const snake = trimmed.replace(/-/g, "_");
  if (ROLE_KEY_ALIASES[snake]) {
    return ROLE_KEY_ALIASES[snake];
  }
  return snake;
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

  return hostConfig;
}

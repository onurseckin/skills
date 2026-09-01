import type { AgentOperationalContract } from "./types.ts";

export const TIER_0_1_GOVERNANCE_AGENTS = [
  "sovereign-mind",
  "mind-auditor",
  "skill-auditor",
  "policy-discovery",
  "owner",
  "independent-planner",
  "independent-planner-auditor",
  "plan-validator",
] as const;

export const TIER_2_ORCHESTRATION_AGENTS = [
  "domain-orchestrator",
  "feature-coordinator",
  "host-platform-specialist",
  "reasoning-specialist",
  "synthesis-specialist",
  "code-specialist",
  "refactoring-specialist",
  "generic-autonomous-agent",
] as const;

export const TIER_3_EXECUTION_AGENTS = [
  "primary-implementer",
  "sub-implementer",
  "sub-investigator",
  "autonomous-repairer",
  "general-task-worker",
] as const;

export const TIER_3_QUALITY_AGENTS = [
  "ui-cognitive-validator",
  "ui-visual-reviewer",
  "ui-headless-debugger",
  "ui-mechanic-validator",
  "general-validator",
  "sub-validator",
  "mechanic-validator",
  "completeness-critic",
  "system-critic",
  "task-critic",
] as const;

export const ALL_31_AGENT_ARCHETYPES = [
  ...TIER_0_1_GOVERNANCE_AGENTS,
  ...TIER_2_ORCHESTRATION_AGENTS,
  ...TIER_3_EXECUTION_AGENTS,
  ...TIER_3_QUALITY_AGENTS,
] as const;

export type AgentArchetypeId = (typeof ALL_31_AGENT_ARCHETYPES)[number];

export const FORBIDDEN_EXEC_TOOLS = [
  "run:exec",
  "shell",
  "run_command",
  "execute_command",
  "terminal",
];

export const FORBIDDEN_WRITE_TOOLS = [
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "create_file",
  "delete_file",
  "task:claim",
];

export function defineContract(contract: AgentOperationalContract): AgentOperationalContract {
  return Object.freeze(contract);
}

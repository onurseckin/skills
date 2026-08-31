import { CODE_EDIT_TOOLS } from "../../platform/index.ts";
import type { BoundaryLeakCheck } from "./types.ts";

export const CODE_MUTATION_ACTIONS: ReadonlySet<string> = CODE_EDIT_TOOLS;

export const SUPERVISORY_ROLES: ReadonlySet<string> = new Set([
  "mind",
  "orchestrator",
  "coordinator",
  "architect",
  "planner",
  "supervisor",
]);

export const PROHIBITED_COGNITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_ACTIONS: ReadonlySet<string> = new Set([
  "run:exec",
  "exec",
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "sh",
  "zsh",
  "run_command",
  "bun test",
  "npm test",
  "pytest",
  "vitest",
  "jest",
  "cargo",
]);

export const MECHANIC_VALIDATOR_ROLES: ReadonlySet<string> = new Set([
  "mechanic-validator",
  "ui-mechanic-validator",
  "ui-headless-validator",
  "headless-validator",
  "mechanic_validator",
]);

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return MECHANIC_VALIDATOR_ROLES.has(normalized);
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized === "ui-optical-validator" ||
    normalized === "optical-validator" ||
    normalized.startsWith("validator-") ||
    normalized.endsWith("-optical-validator")
  );
}

export function isExecutionToolCategory(category: string): boolean {
  return PROHIBITED_COGNITIVE_CATEGORIES.has(category.trim().toLowerCase());
}

export function isProhibitedValidatorExecutionAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  if (PROHIBITED_COGNITIVE_ACTIONS.has(normalized)) return true;
  return (
    normalized.startsWith("run:exec") ||
    normalized.startsWith("bun test") ||
    normalized.startsWith("npm test") ||
    normalized.startsWith("pytest") ||
    normalized.startsWith("cargo test") ||
    normalized.includes("test-runner") ||
    normalized.includes("run_command")
  );
}

export function isCriticOrValidatorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  return (
    normalized === "validator" ||
    normalized === "completeness-critic" ||
    normalized === "critic" ||
    normalized === "sub-validator" ||
    normalized === "plan-validator" ||
    normalized.startsWith("validator-") ||
    normalized.startsWith("critic-") ||
    normalized.endsWith("-validator") ||
    normalized.endsWith("-critic")
  );
}

export function isCriticOrValidatorAgent(agentId: string): boolean {
  const normalized = agentId.trim().toLowerCase();
  return (
    normalized.startsWith("val-") ||
    normalized.startsWith("validator-") ||
    normalized.startsWith("validator_") ||
    normalized.startsWith("critic-") ||
    normalized.startsWith("critic_") ||
    /^val/i.test(normalized) ||
    /^critic/i.test(normalized)
  );
}

export function isSupervisorRole(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  if (SUPERVISORY_ROLES.has(normalized)) return true;
  return (
    normalized.startsWith("mind-") ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-") ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-")
  );
}

export function isCodeMutationAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  if (CODE_MUTATION_ACTIONS.has(normalized)) return true;
  return (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("replace")
  );
}

export function isBoundaryLeakViolation(check: BoundaryLeakCheck): boolean {
  const role = check.role.trim().toLowerCase();
  const isCriticOrVal = isCriticOrValidatorRole(role) || isCriticOrValidatorAgent(check.agent_id);
  const isMechanicVal =
    isMechanicValidatorRole(role) || check.agent_id.trim().toLowerCase().includes("mechanic");
  const isSup = isSupervisorRole(role);
  const action = check.action.trim().toLowerCase();
  const hasWriteScope =
    (check.write_scope && check.write_scope.length > 0) || Boolean(check.target_file);

  // 1. Critic or Validator attempting code write lease / task:claim
  if (
    isCriticOrVal &&
    (action === "task:claim" || action === "task:submit" || action === "claim")
  ) {
    return true;
  }

  // 2. Critic or Validator attempting direct code mutation
  if (isCriticOrVal && isCodeMutationAction(action)) {
    return true;
  }

  // 3. Critic or Validator claiming task with non-empty write scope
  if (isCriticOrVal && hasWriteScope && (action === "task:claim" || action === "claim")) {
    return true;
  }

  // 4. Supervisory role (Tier 0/1/2) claiming task write lease or mutating code
  if (isSup && (action === "task:claim" || action === "claim" || isCodeMutationAction(action))) {
    return true;
  }

  // 5. Metadata indicating self-repair or validator-as-repairer assignment
  if (check.metadata) {
    const assignedRepairer = check.metadata["assigned_repairer"];
    const validatorId = check.metadata["validator_id"];
    if (
      typeof assignedRepairer === "string" &&
      typeof validatorId === "string" &&
      assignedRepairer === validatorId
    ) {
      return true;
    }
  }

  // 6. Cognitive Validator Hard-Lock: Cognitive Validator / Critic attempting execution / shell / test commands
  if (isCriticOrVal && !isMechanicVal) {
    if (isProhibitedValidatorExecutionAction(action)) {
      return true;
    }
    if (check.metadata) {
      const toolCategory = check.metadata["tool_category"] ?? check.metadata["toolCategory"];
      if (typeof toolCategory === "string" && isExecutionToolCategory(toolCategory)) {
        return true;
      }
      const toolName = check.metadata["tool_name"] ?? check.metadata["tool"];
      if (
        typeof toolName === "string" &&
        (PROHIBITED_COGNITIVE_ACTIONS.has(toolName.toLowerCase().trim()) ||
          isExecutionToolCategory(toolName))
      ) {
        return true;
      }
    }
  }

  return false;
}

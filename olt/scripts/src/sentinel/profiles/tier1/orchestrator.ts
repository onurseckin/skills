import {
  inferRoleFromAgentId,
  normalizeRoleName,
  roleToTier,
} from "../../../authority/thread/index.ts";
import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

function isSkillAuditorRole(role: string): boolean {
  if (typeof role !== "string") {
    return false;
  }
  const trimmed = role.trim().toLowerCase();
  if (trimmed === "skill-auditor") {
    return true;
  }
  if (trimmed === "skill_auditor") {
    return true;
  }
  const normalized = normalizeRoleName(role);
  if (normalized === "skill-auditor") {
    return true;
  }
  const inferred = inferRoleFromAgentId(role);
  if (inferred === "skill-auditor") {
    return true;
  }
  return false;
}

export const orchestratorProfile: RoleDiagnosticProfile = {
  role: "orchestrator",
  tier: 1,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const sourceEdits = context.modified_files.filter(
        (f) =>
          !f.startsWith("docs/") &&
          !f.startsWith(".olt/capsules/") &&
          !f.startsWith(".olt/memory.json") &&
          !f.endsWith(".md"),
      );
      if (sourceEdits.length > 0) {
        violations.push({
          code: "ORCHESTRATOR_DIRECT_CODE_MUTATION",
          severity: "CRITICAL",
          message:
            "Tier 1 Orchestrator must not edit source files; dispatch via Tier 2 Coordinator.",
          target_file: sourceEdits[0],
          remediation_cmd: "bun harness.ts task:brief --role coordinator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
        });
      }
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "ORCHESTRATOR_SHELL_EXECUTION_VIOLATION",
        severity: "CRITICAL",
        message:
          "Tier 1 Orchestrator must not execute shell commands; dispatch via Tier 2 Coordinator.",
        remediation_cmd: "bun harness.ts task:brief --role coordinator",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
      });
    }

    const candidateRoles: string[] = [];
    if (context.child_agent_roles !== undefined) {
      candidateRoles.push(...context.child_agent_roles);
    }
    if (context.spawned_agent_roles !== undefined) {
      candidateRoles.push(...context.spawned_agent_roles);
    } else if (context.spawned_roles !== undefined) {
      candidateRoles.push(...context.spawned_roles);
    }
    if (
      context.spawned_roles !== undefined &&
      context.spawned_agent_roles !== undefined &&
      context.spawned_roles !== context.spawned_agent_roles
    ) {
      for (const r of context.spawned_roles) {
        if (!context.spawned_agent_roles.includes(r)) {
          candidateRoles.push(r);
        }
      }
    }
    if (context.role_target !== undefined) {
      candidateRoles.push(context.role_target);
    }

    let auditorCount = 0;
    for (const role of candidateRoles) {
      if (isSkillAuditorRole(role)) {
        auditorCount += 1;
      }
    }

    if (auditorCount > 1) {
      violations.push({
        code: "DUPLICATE_SKILL_AUDITOR_VIOLATION",
        severity: "CRITICAL",
        message:
          "Tier 1 Orchestrator must only be paired with exactly one companion skill-auditor; duplicate skill-auditors detected.",
        remediation_cmd: "bun harness.ts doctor --agent orchestrator",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
      });
    }

    const uniqueRoles = Array.from(new Set(candidateRoles));

    for (const childRole of uniqueRoles) {
      if (isSkillAuditorRole(childRole)) {
        continue;
      }
      const normalized = normalizeRoleName(childRole);
      let resolved: string | null = normalized;
      if (resolved === null) {
        resolved = inferRoleFromAgentId(childRole);
      } else if (resolved === undefined) {
        resolved = inferRoleFromAgentId(childRole);
      }
      let effectiveRole = childRole;
      if (resolved !== null) {
        if (resolved !== undefined) {
          effectiveRole = resolved;
        }
      }
      if (roleToTier(effectiveRole) !== 2) {
        violations.push({
          code: "CROSS_TIER_SPAWNING_VIOLATION",
          severity: "CRITICAL",
          message:
            "Tier 1 Orchestrator must only dispatch Tier 2 Coordinator; direct Tier 3 worker dispatch is prohibited.",
          remediation_cmd: "bun harness.ts task:brief --role coordinator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-31",
        });
      }
    }

    return violations;
  },
};

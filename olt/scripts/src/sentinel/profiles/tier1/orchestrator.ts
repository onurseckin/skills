import { roleToTier } from "../../../authority/guards/spawn-validator.ts";
import { inferRoleFromAgentId, normalizeRoleName } from "../../../authority/thread/index.ts";
import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

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
    if (context.child_agent_roles) {
      candidateRoles.push(...context.child_agent_roles);
    }
    if (context.spawned_agent_roles) {
      candidateRoles.push(...context.spawned_agent_roles);
    }
    if (context.spawned_roles) {
      candidateRoles.push(...context.spawned_roles);
    }
    if (context.role_target) {
      candidateRoles.push(context.role_target);
    }

    const uniqueRoles = Array.from(new Set(candidateRoles));

    for (const childRole of uniqueRoles) {
      const resolved = normalizeRoleName(childRole) ?? inferRoleFromAgentId(childRole);
      if (roleToTier(resolved ?? childRole) !== 2) {
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

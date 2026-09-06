import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const mindProfile: RoleDiagnosticProfile = {
  role: "mind",
  tier: 0,
  can_edit: false,
  can_execute_shell: true,
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
          code: "MIND_DIRECT_CODE_MUTATION",
          severity: "CRITICAL",
          message: "Tier 0 Mind must never modify source code directly; delegate implementation.",
          target_file: sourceEdits[0],
          remediation_cmd: "bun harness.ts task:brief --role orchestrator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        });
      }
    }

    if (
      context.wave_lane_count !== undefined &&
      context.wave_lane_count >= 2 &&
      context.wave_concurrency !== undefined &&
      context.wave_concurrency < 2
    ) {
      violations.push({
        code: "CONCURRENCY_SLA_BREACH",
        severity: "WARN",
        message: `Dynamic wave concurrency P must scale to >= 2 when lanes (${context.wave_lane_count}) >= 2.`,
        remediation_cmd: "bun harness.ts orchestrate --concurrency 2",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      });
    }

    if (context.pending_defects_count !== undefined && context.pending_defects_count > 0) {
      violations.push({
        code: "DEFECT_FIRST_PRIORITIZATION_BREACH",
        severity: "WARN",
        message: `Outstanding high-severity defects (${context.pending_defects_count}) must be prioritized before new tasks.`,
        remediation_cmd: "bun harness.ts report:defects",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
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
    const allowedMindSpawns = new Set(["orchestrator", "mind-auditor", "skill-auditor"]);

    for (const childRole of uniqueRoles) {
      if (!allowedMindSpawns.has(childRole)) {
        violations.push({
          code: "CROSS_TIER_SPAWNING_VIOLATION",
          severity: "CRITICAL",
          message:
            "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
          remediation_cmd: "bun harness.ts task:brief --role orchestrator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        });
      }
    }

    return violations;
  },
};

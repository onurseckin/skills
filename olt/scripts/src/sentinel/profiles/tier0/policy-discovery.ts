import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const policyDiscoveryProfile: RoleDiagnosticProfile = {
  role: "policy-discovery",
  tier: 0,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const sourceEdits = context.modified_files.filter(
        (f) => !f.startsWith(".olt/policy.json") && !f.endsWith(".md"),
      );
      if (sourceEdits.length > 0) {
        violations.push({
          code: "POLICY_DISCOVERY_WRITE_BREACH",
          severity: "CRITICAL",
          message: "Tier 0 Policy Discovery is read-only; zero source file mutations permitted.",
          target_file: sourceEdits[0],
          remediation_cmd: "bun harness.ts policy:discover",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-23",
        });
      }
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "POLICY_DISCOVERY_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message: "Policy Discovery role is restricted from direct shell execution.",
        remediation_cmd: "Use harness view_file and grep_search read-only APIs",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-23",
      });
    }

    return violations;
  },
};

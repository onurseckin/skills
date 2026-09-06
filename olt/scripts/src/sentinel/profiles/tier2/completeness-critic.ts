import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const completenessCriticProfile: RoleDiagnosticProfile = {
  role: "completeness-critic",
  tier: 2,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "CRITIC_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "Completeness Critic evaluates task deliverables and must not modify source code.",
        target_file: context.modified_files[0],
        remediation_cmd: "bun harness.ts critic:evaluate",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-45",
      });
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "CRITIC_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message: "Completeness Critic must not execute terminal shell commands.",
        remediation_cmd: "bun harness.ts critic:evaluate",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-45",
      });
    }

    return violations;
  },
};

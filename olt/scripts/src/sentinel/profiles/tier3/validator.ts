import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const validatorProfile: RoleDiagnosticProfile = {
  role: "validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "VALIDATOR_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message:
          "Cognitive Validator is restricted to zero shell execution; review code socratically.",
        remediation_cmd: "bun harness.ts task:review --verdict pass|fail",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-61",
      });
    }

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "VALIDATOR_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "Cognitive Validator must not modify source code.",
        target_file: context.modified_files[0],
        remediation_cmd: `git checkout -- ${context.modified_files[0]}`,
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-61",
      });
    }

    return violations;
  },
};

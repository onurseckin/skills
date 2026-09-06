import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const planValidatorProfile: RoleDiagnosticProfile = {
  role: "plan-validator",
  tier: 2,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "PLAN_VALIDATOR_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "Tier 2 Plan Validator is read-only auditor of DAG plans; zero edits allowed.",
        target_file: context.modified_files[0],
        remediation_cmd: "bun harness.ts plan:audit",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-43",
      });
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "PLAN_VALIDATOR_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message: "Tier 2 Plan Validator must not run terminal commands.",
        remediation_cmd: "bun harness.ts plan:audit",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-43",
      });
    }

    return violations;
  },
};

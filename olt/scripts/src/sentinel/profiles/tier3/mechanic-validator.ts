import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const mechanicValidatorProfile: RoleDiagnosticProfile = {
  role: "mechanic-validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "MECHANIC_VALIDATOR_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "Mechanic Validator runs AST/type checks and must not edit source files.",
        target_file: context.modified_files[0],
        remediation_cmd: "bun harness.ts task:check",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-62",
      });
    }

    return violations;
  },
};

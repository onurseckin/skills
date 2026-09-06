import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const repairerProfile: RoleDiagnosticProfile = {
  role: "repairer",
  tier: 2,
  can_edit: true,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.write_scope && context.write_scope.length > 0) {
      for (const file of context.modified_files) {
        const inScope = context.write_scope.some(
          (s) => file === s || file.startsWith(s.endsWith("/") ? s : `${s}/`),
        );
        if (!inScope) {
          violations.push({
            code: "OUT_OF_SCOPE_MODIFICATION",
            severity: "CRITICAL",
            message: `Repairer modified '${file}' outside assigned defect scope.`,
            target_file: file,
            remediation_cmd: `Revert changes to ${file}`,
            documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-44",
          });
        }
      }
    }

    if (
      context.modified_files &&
      context.modified_files.length > 0 &&
      context.task_status === "submitted" &&
      context.had_file_scoped_test_run === false
    ) {
      violations.push({
        code: "MISSING_REGRESSION_TEST_RUN",
        severity: "CRITICAL",
        message: "Repaired files submitted without executing targeted regression tests.",
        remediation_cmd: "bun test <target.test.ts>",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-44",
      });
    }

    return violations;
  },
};

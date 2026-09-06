import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const implementerProfile: RoleDiagnosticProfile = {
  role: "implementer",
  tier: 3,
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
            message: `Implementer modified '${file}' outside leased write scope.`,
            target_file: file,
            remediation_cmd: `git checkout -- ${file}`,
            documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-51",
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
      const targetFile = context.modified_files[0] ?? "src/file.ts";
      const testGuess = targetFile.replace(/\.ts$/, ".test.ts").replace(/^src\//, "tests/");
      violations.push({
        code: "MISSING_FILE_SCOPED_TEST_RUN",
        severity: "CRITICAL",
        message: "Source file modified without executing targeted unit test prior to submit.",
        target_file: targetFile,
        remediation_cmd: `bun test ${testGuess}`,
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-51",
      });
    }

    return violations;
  },
};

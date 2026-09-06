import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const subImplementerProfile: RoleDiagnosticProfile = {
  role: "sub-implementer",
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
            code: "SUB_IMPLEMENTER_OUT_OF_SCOPE",
            severity: "CRITICAL",
            message: `Sub-implementer modified '${file}' outside assigned sub-scope.`,
            target_file: file,
            remediation_cmd: `git checkout -- ${file}`,
            documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-52",
          });
        }
      }
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      const broadTests = context.executed_commands.filter((cmd) => {
        const trimmed = cmd.trim();
        return trimmed === "bun test" || trimmed === "bun test ." || trimmed === "vitest";
      });
      if (broadTests.length > 0) {
        violations.push({
          code: "SUB_IMPLEMENTER_BROAD_TEST_BREACH",
          severity: "CRITICAL",
          message: "Sub-implementer must not run repo-wide test suites; run targeted tests only.",
          remediation_cmd: "bun test <target.test.ts>",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-52",
        });
      }
    }

    return violations;
  },
};

export const subInvestigatorProfile: RoleDiagnosticProfile = {
  role: "sub-investigator",
  tier: 3,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "SUB_INVESTIGATOR_WRITE_FORBIDDEN",
        severity: "CRITICAL",
        message: "Sub-investigator is strictly read-only; zero filesystem edits permitted.",
        target_file: context.modified_files[0],
        remediation_cmd: "Use view_file and grep_search",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-53",
      });
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "SUB_INVESTIGATOR_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message: "Sub-investigator must not execute shell commands.",
        remediation_cmd: "Use view_file and grep_search",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-53",
      });
    }

    return violations;
  },
};

export const subValidatorProfile: RoleDiagnosticProfile = {
  role: "sub-validator",
  tier: 3,
  can_edit: true,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const nonEvidenceEdits = context.modified_files.filter(
        (f) =>
          !f.includes("/evidence/") &&
          !f.startsWith(".olt/capsules/") &&
          !f.endsWith(".png") &&
          !f.endsWith(".json"),
      );
      if (nonEvidenceEdits.length > 0) {
        violations.push({
          code: "SUB_VALIDATOR_SOURCE_MUTATION",
          severity: "CRITICAL",
          message:
            "Sub-validator writes proofs strictly into evidence directories; source edits forbidden.",
          target_file: nonEvidenceEdits[0],
          remediation_cmd: `git checkout -- ${nonEvidenceEdits[0]}`,
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-67",
        });
      }
    }

    return violations;
  },
};

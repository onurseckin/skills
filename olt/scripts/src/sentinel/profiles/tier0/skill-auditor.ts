import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const skillAuditorProfile: RoleDiagnosticProfile = {
  role: "skill-auditor",
  tier: 0,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const codeEdits = context.modified_files.filter(
        (f) =>
          !f.startsWith(".olt/defects.jsonl") &&
          !f.startsWith(".olt/auditor-cursors.json") &&
          !f.endsWith(".md"),
      );
      if (codeEdits.length > 0) {
        violations.push({
          code: "AUDITOR_CODE_MUTATION",
          severity: "CRITICAL",
          message:
            "Tier 0 Skill Auditor is an auditing role and must not implement or alter source code.",
          target_file: codeEdits[0],
          remediation_cmd: "bun harness.ts audit:modularity",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-22",
        });
      }
    }

    return violations;
  },
};

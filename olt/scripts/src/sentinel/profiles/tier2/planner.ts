import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const plannerProfile: RoleDiagnosticProfile = {
  role: "planner",
  tier: 2,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const sourceEdits = context.modified_files.filter(
        (f) =>
          !f.startsWith("docs/planning/") &&
          !f.startsWith(".olt/backlog.jsonl") &&
          !f.startsWith(".olt/capsules/") &&
          !f.endsWith(".md"),
      );
      if (sourceEdits.length > 0) {
        violations.push({
          code: "PLANNER_SOURCE_MUTATION",
          severity: "CRITICAL",
          message: "Tier 2 Planner must confine edits to plan artifacts; zero source code edits.",
          target_file: sourceEdits[0],
          remediation_cmd: "bun harness.ts plan:draft",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-42",
        });
      }
    }

    return violations;
  },
};

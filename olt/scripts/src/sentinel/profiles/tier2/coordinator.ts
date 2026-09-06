import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const coordinatorProfile: RoleDiagnosticProfile = {
  role: "coordinator",
  tier: 2,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const sourceEdits = context.modified_files.filter(
        (f) =>
          !f.startsWith("docs/") &&
          !f.startsWith(".olt/capsules/") &&
          !f.startsWith(".olt/backlog.jsonl") &&
          !f.endsWith(".md"),
      );
      if (sourceEdits.length > 0) {
        violations.push({
          code: "COORDINATOR_SOURCE_MUTATION",
          severity: "CRITICAL",
          message: "Tier 2 Coordinator must not edit source files directly; dispatch implementers.",
          target_file: sourceEdits[0],
          remediation_cmd: "bun harness.ts task:brief --role implementer",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-41",
        });
      }
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      const broadTests = context.executed_commands.filter((cmd) => {
        const trimmed = cmd.trim();
        return (
          trimmed === "bun test" ||
          trimmed === "bun test ." ||
          trimmed === "vitest" ||
          trimmed === "npm test"
        );
      });
      if (broadTests.length > 0) {
        violations.push({
          code: "COORDINATOR_BROAD_TEST_SUITE_BREACH",
          severity: "CRITICAL",
          message:
            "Tier 2 Coordinator must never execute full/broad test suites; delegate file-scoped tests.",
          remediation_cmd: "bun harness.ts task:brief --role implementer",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-41",
        });
      }
    }

    if (
      context.wave_lane_count !== undefined &&
      context.wave_lane_count >= 2 &&
      context.wave_concurrency !== undefined &&
      context.wave_concurrency < 2
    ) {
      violations.push({
        code: "FALSE_SERIALIZATION_BLUNDER",
        severity: "CRITICAL",
        message: `Wave contains ${context.wave_lane_count} ready lanes. Mandatory 1-shot parallel dispatch (P >= 2) required.`,
        remediation_cmd: "bun harness.ts task:brief --concurrency 2",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-41",
      });
    }

    return violations;
  },
};

import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const mindAuditorProfile: RoleDiagnosticProfile = {
  role: "mind-auditor",
  tier: 1,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "MIND_AUDITOR_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message: "Tier 1 Mind Auditor must not execute terminal shell commands or unit tests.",
        remediation_cmd: "bun harness.ts msg:send --to mind",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-32",
      });
    }

    if (
      context.mailbox_unpolled_duration_s !== undefined &&
      context.mailbox_unpolled_duration_s > 300
    ) {
      violations.push({
        code: "MAILBOX_STARVATION_DETECTED",
        severity: "WARN",
        message: `Supervisor mailbox has been unpolled for ${context.mailbox_unpolled_duration_s}s (> 300s limit).`,
        remediation_cmd: "bun harness.ts msg:poll --role mind",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-32",
      });
    }

    return violations;
  },
};

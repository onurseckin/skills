import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

export const uiHeadlessValidatorProfile: RoleDiagnosticProfile = {
  role: "ui-headless-validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "UI_HEADLESS_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "UI Headless Validator must not edit source files directly.",
        target_file: context.modified_files[0],
        remediation_cmd: "bun test:playwright --headed=false",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-63",
      });
    }

    return violations;
  },
};

export const uiMechanicValidatorProfile: RoleDiagnosticProfile = {
  role: "ui-mechanic-validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "UI_MECHANIC_SOURCE_MUTATION",
        severity: "CRITICAL",
        message:
          "UI Mechanic Validator audits CSS and responsive DOM; zero source edits permitted.",
        target_file: context.modified_files[0],
        remediation_cmd: "bun harness.ts validate:dom",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-64",
      });
    }

    return violations;
  },
};

export const uiOpticalValidatorProfile: RoleDiagnosticProfile = {
  role: "ui-optical-validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.executed_commands && context.executed_commands.length > 0) {
      violations.push({
        code: "UI_OPTICAL_SHELL_FORBIDDEN",
        severity: "CRITICAL",
        message:
          "UI Optical Validator is strictly visual inspection; zero terminal execution allowed.",
        remediation_cmd: "Use view_file to inspect screenshots in evidence/screenshots/",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-65",
      });
    }

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "UI_OPTICAL_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "UI Optical Validator must not modify source code.",
        target_file: context.modified_files[0],
        remediation_cmd: "Revert source file changes",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-65",
      });
    }

    if (
      context.task_status === "approved" &&
      (!context.reviewed_screenshots || context.reviewed_screenshots.length === 0)
    ) {
      violations.push({
        code: "UI_OPTICAL_VIOLATION",
        severity: "CRITICAL",
        message: "You must inspect screenshot artifacts via view_file before rendering a verdict.",
        remediation_cmd: "view_file evidence/screenshots/<viewport>.png",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-65",
      });
    }

    return violations;
  },
};

export const uiValidatorProfile: RoleDiagnosticProfile = {
  role: "ui-validator",
  tier: 3,
  can_edit: false,
  can_execute_shell: false,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      violations.push({
        code: "UI_VALIDATOR_SOURCE_MUTATION",
        severity: "CRITICAL",
        message: "UI Validator provides holistic UX evaluation and must not edit source files.",
        target_file: context.modified_files[0],
        remediation_cmd: "Revert source file changes",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-66",
      });
    }

    return violations;
  },
};

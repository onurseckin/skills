import { validateUiCognitive } from "./cognitive-validator.ts";
import { validateUiMechanic } from "./mechanic-validator.ts";
import type {
  DualUiAuditResult,
  UiCognitiveInspectionInput,
  UiMechanicInspectionInput,
} from "./types.ts";

export interface DualUiEvaluationParams {
  readonly isUiTask: boolean;
  readonly mechanicInput?: UiMechanicInspectionInput;
  readonly cognitiveInput?: UiCognitiveInspectionInput;
}

export function evaluateDualUiGates(params: DualUiEvaluationParams): DualUiAuditResult {
  if (!params.isUiTask) {
    const emptyMechanic = validateUiMechanic({});
    const emptyCognitive = validateUiCognitive({ critique: "Non-UI task skipped." });
    return {
      isUiTask: false,
      passed: true,
      mode: "non_ui_skipped",
      mechanicReport: emptyMechanic,
      cognitiveReport: emptyCognitive,
      defects: [],
      summary: "Task does not touch UI or frontend scopes. Dual UI validation bypassed.",
    };
  }

  const mechanicReport = validateUiMechanic(params.mechanicInput ?? {});
  const cognitiveReport = validateUiCognitive(params.cognitiveInput ?? { critique: "" });

  const defects: {
    id: string;
    pillar: "mechanical" | "cognitive";
    category: string;
    message: string;
    severity: "critical" | "important" | "minor";
    remediation: string;
  }[] = [];

  for (const touch of mechanicReport.touchTargetFailures) {
    defects.push({
      id: `ui-mech-touch-${touch.selector.replace(/[^a-zA-Z0-9]/g, "-")}`,
      pillar: "mechanical",
      category: "touch-hitbox",
      message: touch.message ?? `Touch target ${touch.selector} below 44pt floor`,
      severity: "important",
      remediation: "Increase touch target size to >= 44x44pt bounding box.",
    });
  }

  for (const overflow of mechanicReport.overflowViolations) {
    defects.push({
      id: `ui-mech-overflow-${overflow.selector.replace(/[^a-zA-Z0-9]/g, "-")}`,
      pillar: "mechanical",
      category: "horizontal-overflow",
      message: overflow.message ?? `Horizontal overflow in ${overflow.selector}`,
      severity: "critical",
      remediation: `Prevent horizontal overflow on viewport ${overflow.viewport}.`,
    });
  }

  for (const violation of cognitiveReport.shellHardlockViolations) {
    defects.push({
      id: "ui-cog-shell-hardlock",
      pillar: "cognitive",
      category: "shell-command-hardlock",
      message: violation,
      severity: "critical",
      remediation: "Cognitive UI Validator must execute 0 shell commands.",
    });
  }

  if (cognitiveReport.isSuperficial) {
    defects.push({
      id: "ui-cog-superficial-critique",
      pillar: "cognitive",
      category: "superficial-critique",
      message: "Validator critique is robotic, empty, or superficial.",
      severity: "important",
      remediation:
        "Provide human-like qualitative English critique evaluating visual hierarchy and harmony.",
    });
  }

  for (const issue of cognitiveReport.descenderIntegrity.issues) {
    defects.push({
      id: "ui-cog-descender-clipping",
      pillar: "cognitive",
      category: "descender-integrity",
      message: issue,
      severity: "important",
      remediation: "Adjust line-height or bottom padding to ensure descenders are not clipped.",
    });
  }

  for (const issue of cognitiveReport.opticalHierarchy.issues) {
    defects.push({
      id: "ui-cog-optical-hierarchy",
      pillar: "cognitive",
      category: "optical-hierarchy",
      message: issue,
      severity: "important",
      remediation: "Restore progressive optical scale hierarchy across headings.",
    });
  }

  const passed = mechanicReport.passed && cognitiveReport.passed;
  const mode = passed
    ? "dual_ui_corroborated"
    : !mechanicReport.passed && cognitiveReport.passed
      ? "cognitive_only"
      : mechanicReport.passed && !cognitiveReport.passed
        ? "mechanic_only"
        : "rejected";

  const summary = passed
    ? "Dual UI Validation passed: Gate 1 (UI Mechanic: 4 viewports, >=44pt hitboxes, 0 overflow) and Gate 2 (Cognitive UI: optical hierarchy, descenders, aesthetic harmony, 0 shell commands) fully satisfied."
    : `Dual UI Validation failed [mode: ${mode}]: ${defects.map((d) => `[${d.pillar}] ${d.message}`).join("; ")}`;

  return {
    isUiTask: true,
    passed,
    mode,
    mechanicReport,
    cognitiveReport,
    defects,
    summary,
  };
}

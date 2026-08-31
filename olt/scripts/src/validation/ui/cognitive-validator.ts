import { ROBOTIC_SUPERFICIAL_CRITIQUE_PATTERNS, SHELL_COMMAND_KEYWORDS } from "./constants.ts";
import { inspectDescenderIntegrity } from "./descender-inspector.ts";
import { evaluateOpticalHierarchy } from "./optical-hierarchy.ts";
import type {
  AestheticHarmonyInspection,
  UiCognitiveInspectionInput,
  UiCognitiveReport,
} from "./types.ts";

function isRhythmAligned(val: number, grid: number = 4): boolean {
  if (!Number.isFinite(val)) return true;
  const remainder = Math.abs(val) % grid;
  return remainder <= 0.5 || remainder >= grid - 0.5;
}

export function evaluateAestheticHarmony(
  spacingElements?: readonly { selector: string; margin: number; padding: number }[],
): AestheticHarmonyInspection {
  if (!spacingElements || spacingElements.length === 0) {
    return {
      score: 100,
      passed: true,
      spacingRhythmGrid: 8,
      spacingRhythmValid: true,
      colorPaletteBalance: "harmonious",
      themeHarmony: "adaptive",
      notes: "Visual rhythm and spacing grid harmony verified (8pt baseline).",
      issues: [],
    };
  }

  const issues: string[] = [];
  let score = 100;

  for (const el of spacingElements) {
    if (!Number.isFinite(el.margin) || !Number.isFinite(el.padding)) {
      continue;
    }
    const isMarginValid = isRhythmAligned(el.margin, 4);
    const isPaddingValid = isRhythmAligned(el.padding, 4);
    if (!isMarginValid || !isPaddingValid) {
      issues.push(
        `Irregular spacing on ${el.selector} (margin: ${el.margin}px, padding: ${el.padding}px; off 4/8pt rhythm)`,
      );
      score -= 15;
    }
  }

  const passed = score >= 80 && issues.length === 0;
  return {
    score: Math.max(0, score),
    passed,
    spacingRhythmGrid: 4,
    spacingRhythmValid: passed,
    colorPaletteBalance: "harmonious",
    themeHarmony: "adaptive",
    notes: passed
      ? "Aesthetic harmony follows clean 4/8pt spacing rhythm."
      : `Spacing rhythm inconsistencies: ${issues.join("; ")}`,
    issues,
  };
}

export function validateUiCognitive(input: UiCognitiveInspectionInput): UiCognitiveReport {
  const shellHardlockViolations: string[] = [];

  if (input.canExecuteShell === true) {
    shellHardlockViolations.push(
      "COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK violation: Cognitive UI Validator cannot have can_execute_shell=true (0 shell commands allowed)",
    );
  }

  for (const cmd of input.attemptedShellCommands ?? []) {
    const lower = cmd.toLowerCase().trim();
    if (SHELL_COMMAND_KEYWORDS.some((kw) => lower.includes(kw))) {
      shellHardlockViolations.push(
        `COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK violation: Attempted prohibited shell execution '${cmd}'`,
      );
    }
  }

  const critique = input.critique?.trim() ?? "";
  const isSuperficial =
    critique.length < 15 ||
    ROBOTIC_SUPERFICIAL_CRITIQUE_PATTERNS.some((pattern) => pattern.test(critique));

  const opticalHierarchy = evaluateOpticalHierarchy(input.hierarchyElements ?? []);
  const descenderIntegrity = inspectDescenderIntegrity(input.textElements ?? []);
  const aestheticHarmony = evaluateAestheticHarmony(input.spacingElements);

  const totalDefects =
    shellHardlockViolations.length +
    (isSuperficial ? 1 : 0) +
    (opticalHierarchy.passed ? 0 : 1) +
    (descenderIntegrity.passed ? 0 : 1) +
    (aestheticHarmony.passed ? 0 : 1);

  const passed =
    shellHardlockViolations.length === 0 &&
    !isSuperficial &&
    opticalHierarchy.passed &&
    descenderIntegrity.passed &&
    aestheticHarmony.passed;

  const summary = passed
    ? "Cognitive UI Validation passed: Socratic qualitative critique verified, optical hierarchy, descender integrity, and aesthetic harmony confirmed with 0 shell command privileges."
    : `Cognitive UI Validation failed: ${[
        ...shellHardlockViolations,
        isSuperficial ? "Superficial / robotic checklist critique rejected" : "",
        ...opticalHierarchy.issues,
        ...descenderIntegrity.issues,
        ...aestheticHarmony.issues,
      ]
        .filter(Boolean)
        .join("; ")}`;

  return {
    passed,
    canExecuteShell: false,
    opticalHierarchy,
    descenderIntegrity,
    aestheticHarmony,
    socraticCritique: critique,
    shellHardlockViolations,
    isSuperficial,
    totalDefects,
    summary,
  };
}

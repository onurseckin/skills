import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  formatValidateUiBrief,
  validateUiCommand,
} from "../../../../olt/scripts/src/cli/commands/validate-ui.ts";
import { assertDualUiGateApproval } from "../../../../olt/scripts/src/cli/commands/task-review-helpers.ts";
import type { DualUiAuditResult } from "../../../../olt/scripts/src/validation/ui/index.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

describe("Dual UI Review Gates & CLI Command Workflow", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  describe("1. assertDualUiGateApproval Helper Enforcement", () => {
    it("returns non-UI bypassed result when isUiTask is false", () => {
      const result = assertDualUiGateApproval("task-1", false, {}, { canExecuteShell: false });
      expect(result.isUiTask).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("non_ui_skipped");
    });

    it("passes when both mechanic and cognitive inputs are compliant", () => {
      const result = assertDualUiGateApproval(
        "task-ui-1",
        true,
        {
          touchTargets: [{ selector: "button.cta", width: 48, height: 48 }],
          overflowElements: [{ selector: "main", scrollWidth: 390, clientWidth: 390 }],
        },
        {
          critique: "Deep Socratic critique evaluating optical balance and typographic hierarchy.",
          canExecuteShell: false,
        },
      );

      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("dual_ui_corroborated");
    });

    it("throws HarnessError on mechanic failure (undersized touch hitbox)", () => {
      expect(() =>
        assertDualUiGateApproval(
          "task-ui-fail-mech",
          true,
          {
            touchTargets: [{ selector: "button.tiny", width: 28, height: 28 }],
          },
          {
            critique: "Deep Socratic critique evaluating optical balance.",
            canExecuteShell: false,
          },
        ),
      ).toThrow("Dual UI Validator Separation mandate not satisfied");
    });

    it("throws HarnessError on cognitive failure (superficial critique)", () => {
      expect(() =>
        assertDualUiGateApproval(
          "task-ui-fail-cog",
          true,
          {
            touchTargets: [{ selector: "button.cta", width: 48, height: 48 }],
          },
          {
            critique: "lgtm", // superficial!
            canExecuteShell: false,
          },
        ),
      ).toThrow("Dual UI Validator Separation mandate not satisfied");
    });

    it("throws HarnessError if cognitive validator attempts shell command execution", () => {
      expect(() =>
        assertDualUiGateApproval(
          "task-ui-fail-shell",
          true,
          {
            touchTargets: [{ selector: "button.cta", width: 48, height: 48 }],
          },
          {
            critique: "Deep Socratic critique evaluating optical balance.",
            attemptedShellCommands: ["run_command bun test"],
            canExecuteShell: false,
          },
        ),
      ).toThrow("COGNITIVE_VALIDATOR_ZERO_COMMANDS_HARDLOCK");
    });
  });

  describe("2. formatValidateUiBrief Markdown Formatting", () => {
    it("formats passing dual UI validation report", () => {
      const mockResult: DualUiAuditResult = {
        isUiTask: true,
        passed: true,
        mode: "dual_ui_corroborated",
        mechanicReport: {
          passed: true,
          viewportsCovered: ["mobile", "tablet", "desktop", "desktop-wide"],
          missingViewports: [],
          touchTargetEvaluations: [
            { selector: "button", width: 48, height: 48, passed: true, minRequired: 44 },
          ],
          touchTargetFailures: [],
          overflowEvaluations: [],
          overflowViolations: [],
          journeyResults: [],
          validScreenshotsCount: 4,
          totalDefects: 0,
          summary: "Mechanic all pass",
        },
        cognitiveReport: {
          passed: true,
          canExecuteShell: false,
          opticalHierarchy: {
            score: 100,
            passed: true,
            headingScaleRatio: 1.25,
            visualWeightBalanced: true,
            notes: "ok",
            issues: [],
          },
          descenderIntegrity: {
            passed: true,
            clippedElements: [],
            elementsInspected: 1,
            descenderCharactersChecked: ["g", "j"],
            notes: "ok",
            issues: [],
          },
          aestheticHarmony: {
            score: 100,
            passed: true,
            spacingRhythmGrid: 8,
            spacingRhythmValid: true,
            colorPaletteBalance: "ok",
            themeHarmony: "dark",
            notes: "ok",
            issues: [],
          },
          socraticCritique: "Comprehensive visual audit.",
          shellHardlockViolations: [],
          isSuperficial: false,
          totalDefects: 0,
          summary: "Cognitive all pass",
        },
        defects: [],
        summary: "Dual UI Validation passed.",
      };

      const brief = formatValidateUiBrief(mockResult, "task-42");
      expect(brief).toContain("Dual UI Validation Report: `task-42`");
      expect(brief).toContain("Gate 1: UI Mechanic Validator");
      expect(brief).toContain("Gate 2: Cognitive UI Validator");
      expect(brief).toContain("0 commands allowed (can_execute_shell: false)");
      expect(brief).toContain("Touch Hitboxes (>= 44pt)");
    });

    it("formats failing report highlighting defect categories", () => {
      const failingResult: DualUiAuditResult = {
        isUiTask: true,
        passed: false,
        mode: "rejected",
        mechanicReport: {
          passed: false,
          viewportsCovered: ["mobile"],
          missingViewports: ["tablet", "desktop", "desktop-wide"],
          touchTargetEvaluations: [
            { selector: "button.tiny", width: 30, height: 30, passed: false, minRequired: 44 },
          ],
          touchTargetFailures: [
            { selector: "button.tiny", width: 30, height: 30, passed: false, minRequired: 44 },
          ],
          overflowEvaluations: [],
          overflowViolations: [],
          journeyResults: [],
          validScreenshotsCount: 0,
          totalDefects: 2,
          summary: "Mechanic failed",
        },
        cognitiveReport: {
          passed: false,
          canExecuteShell: false,
          opticalHierarchy: {
            score: 50,
            passed: false,
            headingScaleRatio: 1.0,
            visualWeightBalanced: false,
            notes: "inverted",
            issues: ["Inverted scale"],
          },
          descenderIntegrity: {
            passed: true,
            clippedElements: [],
            elementsInspected: 0,
            descenderCharactersChecked: [],
            notes: "ok",
            issues: [],
          },
          aestheticHarmony: {
            score: 60,
            passed: false,
            spacingRhythmGrid: 4,
            spacingRhythmValid: false,
            colorPaletteBalance: "bad",
            themeHarmony: "inconsistent",
            notes: "bad",
            issues: ["Irregular margin"],
          },
          socraticCritique: "lgtm",
          shellHardlockViolations: [],
          isSuperficial: true,
          totalDefects: 3,
          summary: "Cognitive failed",
        },
        defects: [
          {
            id: "d-1",
            pillar: "mechanical",
            category: "touch-hitbox",
            message: "Button below 44pt",
            severity: "important",
            remediation: "Increase size",
          },
          {
            id: "d-2",
            pillar: "cognitive",
            category: "optical-hierarchy",
            message: "Inverted scale",
            severity: "important",
            remediation: "Fix scale",
          },
        ],
        summary: "Dual UI Validation failed.",
      };

      const brief = formatValidateUiBrief(failingResult, "task-failing");
      expect(brief).toContain("❌ Dual UI Validation Report: `task-failing`");
      expect(brief).toContain("Defects Detected");
      expect(brief).toContain("[MECHANICAL]");
      expect(brief).toContain("[COGNITIVE]");
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  ALL_4_VIEWPORT_TIERS,
  CANONICAL_4_VIEWPORTS,
  DESCENDER_CHARS,
  MIN_SCREENSHOT_BYTES,
  MIN_TOUCH_HITBOX_PT,
  calculateOpticalWeight,
  evaluateAestheticHarmony,
  evaluateDualUiGates,
  evaluateOpticalHierarchy,
  inspectAllOverflowElements,
  inspectAllTouchHitboxes,
  inspectDescenderIntegrity,
  inspectHorizontalOverflow,
  inspectTouchHitbox,
  normalizeWeightMultiplier,
  validateUiCognitive,
  validateUiMechanic,
} from "../../../../olt/scripts/src/validation/ui/index.ts";


describe("Dual UI Validators - Cognitive & Gate Evaluation", () => {
  describe("3. Cognitive UI Validator (Optical Hierarchy, Descenders, Aesthetic Harmony, 0 Shell)", () => {
    it("enforces 0 shell commands hardlock", () => {
      const report = validateUiCognitive({
        canExecuteShell: true,
        attemptedShellCommands: ["run_command bun test", "exec sh script.sh"],
        critique: "Detailed qualitative review of visual layout and contrast.",
      });

      expect(report.passed).toBe(false);
      expect(report.canExecuteShell).toBe(false);
      expect(report.shellHardlockViolations.length).toBe(3);
    });

    it("rejects superficial / robotic checklist critiques", () => {
      const roboticPhrases = [
        "lgtm",
        "looks good",
        "all tests pass",
        "verified manually",
        "ui checklist verified",
      ];
      for (const phrase of roboticPhrases) {
        const report = validateUiCognitive({ critique: phrase });
        expect(report.isSuperficial).toBe(true);
        expect(report.passed).toBe(false);
      }
    });

    it("evaluates optical hierarchy and catches inverted font scales", () => {
      const valid = evaluateOpticalHierarchy([
        { selector: "h1", tag: "h1", fontSize: 32, fontWeight: 700 },
        { selector: "h2", tag: "h2", fontSize: 24, fontWeight: 600 },
      ]);
      expect(valid.passed).toBe(true);

      const inverted = evaluateOpticalHierarchy([
        { selector: "h1", tag: "h1", fontSize: 18, fontWeight: 400 },
        { selector: "h2", tag: "h2", fontSize: 24, fontWeight: 700 },
      ]);
      expect(inverted.passed).toBe(false);
      expect(inverted.issues[0]).toContain("Inverted optical scale");
    });

    it("inspects descender integrity and flags clipped descender letters", () => {
      const passResult = inspectDescenderIntegrity([
        {
          selector: "span.label",
          text: "Typography jump",
          fontSize: 16,
          lineHeight: 24,
          paddingBottom: 4,
        },
      ]);
      expect(passResult.passed).toBe(true);

      const failResult = inspectDescenderIntegrity([
        {
          selector: "span.clipped",
          text: "Typography jump",
          fontSize: 16,
          lineHeight: 16,
          paddingBottom: 0,
          overflowClipped: true,
        },
      ]);
      expect(failResult.passed).toBe(false);
      expect(failResult.clippedElements).toContain("span.clipped");
    });

    it("evaluates aesthetic harmony across 4/8pt spacing rhythm", () => {
      const passResult = evaluateAestheticHarmony([{ selector: ".card", margin: 16, padding: 24 }]);
      expect(passResult.passed).toBe(true);

      const failResult = evaluateAestheticHarmony([{ selector: ".card", margin: 13, padding: 27 }]);
      expect(failResult.passed).toBe(false);
    });

    it("passes cognitive validation when all human-level aesthetic criteria are met", () => {
      const report = validateUiCognitive({
        critique:
          "The header typography establishes clear visual hierarchy. Spacing follows an 8pt rhythm with adequate line-height for descenders on action buttons.",
        hierarchyElements: [
          { selector: "h1", tag: "h1", fontSize: 36, fontWeight: 800 },
          { selector: "p", tag: "p", fontSize: 16, fontWeight: 400 },
        ],
        textElements: [
          {
            selector: "p.body",
            text: "Quality typography and styling",
            fontSize: 16,
            lineHeight: 24,
            paddingBottom: 8,
          },
        ],
        spacingElements: [{ selector: "div.section", margin: 32, padding: 24 }],
        canExecuteShell: false,
      });

      expect(report.passed).toBe(true);
      expect(report.opticalHierarchy.passed).toBe(true);
      expect(report.descenderIntegrity.passed).toBe(true);
      expect(report.aestheticHarmony.passed).toBe(true);
      expect(report.shellHardlockViolations.length).toBe(0);
    });
  });

  describe("4. Dual UI Gate Sequential Evaluation", () => {
    it("bypasses dual UI validation for non-UI tasks cleanly", () => {
      const result = evaluateDualUiGates({ isUiTask: false });
      expect(result.isUiTask).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("non_ui_skipped");
    });

    it("corroborates when both Gate 1 (Mechanic) and Gate 2 (Cognitive) pass", () => {
      const result = evaluateDualUiGates({
        isUiTask: true,
        mechanicInput: {
          touchTargets: [{ selector: "button.submit", width: 48, height: 48 }],
          overflowElements: [{ selector: "div.main", scrollWidth: 390, clientWidth: 390 }],
          screenshots: [
            { name: "m.png", path: "sc/m.png", viewport: "mobile", sizeBytes: 2048 },
            { name: "t.png", path: "sc/t.png", viewport: "tablet", sizeBytes: 2048 },
            { name: "d.png", path: "sc/d.png", viewport: "desktop", sizeBytes: 2048 },
            { name: "dw.png", path: "sc/dw.png", viewport: "desktop-wide", sizeBytes: 2048 },
          ],
        },
        cognitiveInput: {
          critique:
            "Deep Socratic critique evaluating optical balance and typographic scale across all breakpoints.",
          hierarchyElements: [{ selector: "h1", tag: "h1", fontSize: 32, fontWeight: 700 }],
          textElements: [
            {
              selector: "h1",
              text: "Typography Page",
              fontSize: 32,
              lineHeight: 40,
              paddingBottom: 8,
            },
          ],
          canExecuteShell: false,
        },
      });

      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("dual_ui_corroborated");
    });

    it("rejects when Gate 1 (Mechanic) fails even if Cognitive passes", () => {
      const result = evaluateDualUiGates({
        isUiTask: true,
        mechanicInput: { touchTargets: [{ selector: "button.small", width: 28, height: 28 }] },
        cognitiveInput: {
          critique: "The layout looks aesthetically balanced.",
          canExecuteShell: false,
        },
      });
      expect(result.passed).toBe(false);
      expect(result.mode).toBe("cognitive_only");
    });

    it("rejects when Gate 2 (Cognitive) fails even if Mechanic passes", () => {
      const result = evaluateDualUiGates({
        isUiTask: true,
        mechanicInput: { touchTargets: [{ selector: "button.cta", width: 48, height: 48 }] },
        cognitiveInput: { critique: "looks good", canExecuteShell: false },
      });
      expect(result.passed).toBe(false);
      expect(result.mode).toBe("mechanic_only");
    });
  });

});

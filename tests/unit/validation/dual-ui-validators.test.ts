import { describe, expect, it } from "bun:test";
import {
  ALL_4_VIEWPORT_TIERS,
  CANONICAL_4_VIEWPORTS,
  DESCENDER_CHARS,
  MIN_SCREENSHOT_BYTES,
  MIN_TOUCH_HITBOX_PT,
  evaluateAestheticHarmony,
  evaluateDualUiGates,
  evaluateOpticalHierarchy,
  inspectAllOverflowElements,
  inspectAllTouchHitboxes,
  inspectDescenderIntegrity,
  inspectHorizontalOverflow,
  inspectTouchHitbox,
  validateUiCognitive,
  validateUiMechanic,
} from "../../../olt/scripts/src/validation/ui/index.ts";

describe("Dual UI Validators: Separation & Invariants", () => {
  describe("1. Canonical 4-Tier Viewports & Constants", () => {
    it("defines canonical 4 viewport tiers with exact pixel dimensions", () => {
      expect(ALL_4_VIEWPORT_TIERS).toEqual(["mobile", "tablet", "desktop", "desktop-wide"]);
      expect(CANONICAL_4_VIEWPORTS.mobile.width).toBe(390);
      expect(CANONICAL_4_VIEWPORTS.mobile.height).toBe(844);
      expect(CANONICAL_4_VIEWPORTS.tablet.width).toBe(768);
      expect(CANONICAL_4_VIEWPORTS.tablet.height).toBe(1024);
      expect(CANONICAL_4_VIEWPORTS.desktop.width).toBe(1440);
      expect(CANONICAL_4_VIEWPORTS.desktop.height).toBe(900);
      expect(CANONICAL_4_VIEWPORTS["desktop-wide"].width).toBe(1920);
      expect(CANONICAL_4_VIEWPORTS["desktop-wide"].height).toBe(1080);
    });

    it("mandates >= 44pt touch hitbox and >= 1024 bytes screenshot floor", () => {
      expect(MIN_TOUCH_HITBOX_PT).toBe(44);
      expect(MIN_SCREENSHOT_BYTES).toBe(1024);
    });

    it("declares standard descender characters", () => {
      expect(DESCENDER_CHARS).toContain("g");
      expect(DESCENDER_CHARS).toContain("j");
      expect(DESCENDER_CHARS).toContain("p");
      expect(DESCENDER_CHARS).toContain("q");
      expect(DESCENDER_CHARS).toContain("y");
    });
  });

  describe("2. UI Mechanic Validator (Hitbox, Overflow, Playwright Journeys)", () => {
    it("evaluates touch hitboxes against the 44pt floor", () => {
      const passTarget = inspectTouchHitbox("button.cta", 48, 48);
      expect(passTarget.passed).toBe(true);
      expect(passTarget.minRequired).toBe(44);

      const failTarget = inspectTouchHitbox("button.small-icon", 32, 32);
      expect(failTarget.passed).toBe(false);
      expect(failTarget.message).toContain("violates minimum 44x44pt");
    });

    it("evaluates batch touch hitboxes filtering interactive elements", () => {
      const targets = [
        { selector: "button.submit", width: 44, height: 44, isInteractive: true },
        { selector: "a.nav-link", width: 48, height: 36, isInteractive: true },
        { selector: "div.banner", width: 300, height: 20, isInteractive: false },
      ];
      const { evaluations, failures } = inspectAllTouchHitboxes(targets);
      expect(evaluations.length).toBe(2);
      expect(failures.length).toBe(1);
      expect(failures[0]!.selector).toBe("a.nav-link");
    });

    it("detects horizontal overflow when scrollWidth exceeds clientWidth", () => {
      const passEl = inspectHorizontalOverflow(".container", "desktop", 1200, 1200);
      expect(passEl.hasOverflow).toBe(false);

      const failEl = inspectHorizontalOverflow(".wide-table", "mobile", 600, 390);
      expect(failEl.hasOverflow).toBe(true);
      expect(failEl.overflowX).toBe(210);
    });

    it("runs complete UI mechanic validation across 4 viewports, journeys, and screenshots", () => {
      const report = validateUiMechanic({
        taskId: "task-ui-1",
        touchTargets: [
          { selector: "button.main", width: 48, height: 48 },
          { selector: "input.search", width: 200, height: 44 },
        ],
        overflowElements: [{ selector: "main.content", scrollWidth: 390, clientWidth: 390 }],
        journeys: [
          { name: "checkout", viewport: "desktop", passed: true, durationMs: 1200 },
          { name: "mobile-nav", viewport: "mobile", passed: true, durationMs: 800 },
        ],
        screenshots: [
          { name: "desktop.png", path: "sc/desktop.png", viewport: "desktop", sizeBytes: 5400 },
          { name: "mobile.png", path: "sc/mobile.png", viewport: "mobile", sizeBytes: 2100 },
          { name: "tablet.png", path: "sc/tablet.png", viewport: "tablet", sizeBytes: 3200 },
          { name: "desktop-wide.png", path: "sc/wide.png", viewport: "desktop-wide", sizeBytes: 8500 },
        ],
      });

      expect(report.passed).toBe(true);
      expect(report.touchTargetFailures.length).toBe(0);
      expect(report.overflowViolations.length).toBe(0);
      expect(report.validScreenshotsCount).toBe(4);
    });

    it("flags defects when touch hitbox is undersized or horizontal overflow exists", () => {
      const report = validateUiMechanic({
        taskId: "task-ui-2",
        touchTargets: [{ selector: "button.tiny", width: 28, height: 28 }],
        overflowElements: [{ selector: "table.grid", scrollWidth: 500, clientWidth: 390 }],
        journeys: [{ name: "failing", viewport: "mobile", passed: false, durationMs: 400 }],
        screenshots: [{ name: "tiny.png", path: "sc/tiny.png", viewport: "mobile", sizeBytes: 512 }],
      });

      expect(report.passed).toBe(false);
      expect(report.touchTargetFailures.length).toBe(1);
      expect(report.overflowViolations.length).toBe(1);
      expect(report.validScreenshotsCount).toBe(0);
    });
  });

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
      const roboticPhrases = ["lgtm", "looks good", "all tests pass", "verified manually", "ui checklist verified"];
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
        { selector: "span.label", text: "Typography jump", fontSize: 16, lineHeight: 24, paddingBottom: 4 },
      ]);
      expect(passResult.passed).toBe(true);

      const failResult = inspectDescenderIntegrity([
        { selector: "span.clipped", text: "Typography jump", fontSize: 16, lineHeight: 16, paddingBottom: 0, overflowClipped: true },
      ]);
      expect(failResult.passed).toBe(false);
      expect(failResult.clippedElements).toContain("span.clipped");
    });

    it("evaluates aesthetic harmony across 4/8pt spacing rhythm", () => {
      const passResult = evaluateAestheticHarmony([
        { selector: ".card", margin: 16, padding: 24 },
      ]);
      expect(passResult.passed).toBe(true);

      const failResult = evaluateAestheticHarmony([
        { selector: ".card", margin: 13, padding: 27 },
      ]);
      expect(failResult.passed).toBe(false);
    });

    it("passes cognitive validation when all human-level aesthetic criteria are met", () => {
      const report = validateUiCognitive({
        critique: "The header typography establishes clear visual hierarchy. Spacing follows an 8pt rhythm with adequate line-height for descenders on action buttons.",
        hierarchyElements: [
          { selector: "h1", tag: "h1", fontSize: 36, fontWeight: 800 },
          { selector: "p", tag: "p", fontSize: 16, fontWeight: 400 },
        ],
        textElements: [
          { selector: "p.body", text: "Quality typography and styling", fontSize: 16, lineHeight: 24, paddingBottom: 8 },
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
          critique: "Deep Socratic critique evaluating optical balance and typographic scale across all breakpoints.",
          hierarchyElements: [{ selector: "h1", tag: "h1", fontSize: 32, fontWeight: 700 }],
          textElements: [{ selector: "h1", text: "Typography Page", fontSize: 32, lineHeight: 40, paddingBottom: 8 }],
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
        cognitiveInput: { critique: "The layout looks aesthetically balanced.", canExecuteShell: false },
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

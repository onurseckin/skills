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

describe("Dual UI Validators - Pairing & Viewports", () => {
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

    it("evaluates batch overflow elements across viewports", () => {
      const { evaluations, violations } = inspectAllOverflowElements([
        { selector: ".header", scrollWidth: 390, clientWidth: 390, viewport: "mobile" },
        { selector: ".table-wide", scrollWidth: 800, clientWidth: 390, viewport: "mobile" },
      ]);
      expect(evaluations.length).toBe(2);
      expect(violations.length).toBe(1);
      expect(violations[0]!.selector).toBe(".table-wide");
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
          {
            name: "desktop-wide.png",
            path: "sc/wide.png",
            viewport: "desktop-wide",
            sizeBytes: 8500,
          },
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
        screenshots: [
          { name: "tiny.png", path: "sc/tiny.png", viewport: "mobile", sizeBytes: 512 },
        ],
      });

      expect(report.passed).toBe(false);
      expect(report.touchTargetFailures.length).toBe(1);
      expect(report.overflowViolations.length).toBe(1);
      expect(report.validScreenshotsCount).toBe(0);
    });
  });
});

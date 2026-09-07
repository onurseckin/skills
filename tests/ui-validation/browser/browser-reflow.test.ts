import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  STANDARD_VIEWPORTS,
  TOUCH_HITBOX_MINIMUMS,
  ResponsiveReflowProber,
  BrowserChoreographyEngine,
  getDefaultBrowserChoreographyEngine,
  setDefaultBrowserChoreographyEngine,
  resetDefaultBrowserChoreographyEngine,
  type TouchHitbox,
} from "../fixtures.ts";

describe("Browser Choreography - Responsive Reflow", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Responsive Reflow & Breakpoint Probing", () => {
    it("verifies standard viewports definitions and touch hitbox minimums", () => {
      expect(STANDARD_VIEWPORTS.ULTRA_WIDE_DESKTOP.width).toBe(1920);
      expect(STANDARD_VIEWPORTS.STANDARD_DESKTOP.width).toBe(1440);
      expect(STANDARD_VIEWPORTS.TABLET_PORTRAIT.width).toBe(768);
      expect(STANDARD_VIEWPORTS.MOBILE_PORTRAIT.width).toBe(390);

      expect(TOUCH_HITBOX_MINIMUMS.STANDARD.width).toBe(44);
      expect(TOUCH_HITBOX_MINIMUMS.COCKPIT.width).toBe(48);
    });

    it("validates touch hitboxes for standard and cockpit controls", () => {
      const prober = new ResponsiveReflowProber();
      const hitboxes: TouchHitbox[] = [
        { elementId: "btn-submit", selector: "#btn-submit", width: 44, height: 44 },
        { elementId: "btn-small", selector: ".icon-btn", width: 32, height: 32 },
        {
          elementId: "cockpit-abort",
          selector: "#abort-btn",
          width: 48,
          height: 48,
          isCockpitControl: true,
        },
        {
          elementId: "cockpit-small",
          selector: "#arm-btn",
          width: 44,
          height: 44,
          isCockpitControl: true,
        },
      ];

      const results = prober.validateTouchHitboxes(hitboxes);
      expect(results[0].compliant).toBe(true);
      expect(results[1].compliant).toBe(false);
      expect(results[2].compliant).toBe(true);
      expect(results[3].compliant).toBe(false);
    });

    it("probes individual breakpoint metrics and mobile menu transitions", () => {
      const prober = new ResponsiveReflowProber();
      const passResult = prober.probeBreakpoint(STANDARD_VIEWPORTS.MOBILE_PORTRAIT, {
        scrollWidth: 390,
        clientWidth: 390,
        clippedElements: [],
        hitboxes: [{ elementId: "menu-btn", selector: "#menu", width: 48, height: 48 }],
        mobileMenu: {
          triggerSelector: "#menu-toggle",
          menuSelector: "#mobile-drawer",
          opensOnTap: true,
          animatesSmoothly: true,
          closesOnSelectionOrBackdrop: true,
        },
      });

      expect(passResult.reflowPassed).toBe(true);
      expect(passResult.horizontalScrollDetected).toBe(false);
      expect(passResult.violations.length).toBe(0);

      const failResult = prober.probeBreakpoint(STANDARD_VIEWPORTS.MOBILE_PORTRAIT, {
        scrollWidth: 420,
        clientWidth: 390,
        clippedElements: [".table-container"],
        mobileMenu: {
          triggerSelector: "#menu-toggle",
          menuSelector: "#mobile-drawer",
          opensOnTap: false,
          animatesSmoothly: false,
          closesOnSelectionOrBackdrop: false,
        },
      });

      expect(failResult.reflowPassed).toBe(false);
      expect(failResult.horizontalScrollDetected).toBe(true);
      expect(failResult.violations.length).toBeGreaterThanOrEqual(3);
    });

    it("probes all 4 standard breakpoints", () => {
      const prober = new ResponsiveReflowProber();
      const map = {
        "ultra-wide-desktop": { scrollWidth: 1920, clientWidth: 1920 },
        "standard-desktop": { scrollWidth: 1440, clientWidth: 1440 },
        "tablet-portrait": { scrollWidth: 768, clientWidth: 768 },
        "mobile-portrait": { scrollWidth: 390, clientWidth: 390 },
      };

      const results = prober.probeAllStandardBreakpoints(map);
      expect(results["ultra-wide-desktop"].reflowPassed).toBe(true);
      expect(results["standard-desktop"].reflowPassed).toBe(true);
      expect(results["tablet-portrait"].reflowPassed).toBe(true);
      expect(results["mobile-portrait"].reflowPassed).toBe(true);
    });

    it("throws HarnessError on invalid responsive prober inputs", () => {
      const prober = new ResponsiveReflowProber();
      expect(() => prober.validateTouchHitboxes(null as unknown as TouchHitbox[])).toThrow(
        HarnessError,
      );
      expect(() =>
        prober.probeBreakpoint(null as unknown as never, null as unknown as never),
      ).toThrow(HarnessError);
      expect(() => prober.probeAllStandardBreakpoints(null as unknown as never)).toThrow(
        HarnessError,
      );
    });
  });

  describe("BrowserChoreographyEngine Singleton", () => {
    it("manages singleton instance getters, setters, and resetters", () => {
      const engine1 = getDefaultBrowserChoreographyEngine();
      const engine2 = getDefaultBrowserChoreographyEngine();
      expect(engine1).toBe(engine2);

      const custom = new BrowserChoreographyEngine();
      setDefaultBrowserChoreographyEngine(custom);
      expect(getDefaultBrowserChoreographyEngine()).toBe(custom);

      resetDefaultBrowserChoreographyEngine();
      const fresh = getDefaultBrowserChoreographyEngine();
      expect(fresh).not.toBe(custom);
    });
  });
});

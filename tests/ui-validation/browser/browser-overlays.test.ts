import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  Z_INDEX_HIERARCHY,
  Z_INDEX_LAYER_RANGES,
  OverlayOrchestrator,
  resetDefaultBrowserChoreographyEngine,
  type OverlayDescriptor,
} from "../fixtures.ts";

describe("Browser Choreography - Z-Index & Overlays", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Z-Index Elevation Hierarchy & Overlays", () => {
    it("verifies canonical Z-Index hierarchy values and ranges", () => {
      expect(Z_INDEX_HIERARCHY.BASE).toBe(0);
      expect(Z_INDEX_HIERARCHY.STICKY).toBe(100);
      expect(Z_INDEX_HIERARCHY.DROPDOWN).toBe(800);
      expect(Z_INDEX_HIERARCHY.DRAWER).toBe(900);
      expect(Z_INDEX_HIERARCHY.BACKDROP).toBe(950);
      expect(Z_INDEX_HIERARCHY.MODAL).toBe(1000);
      expect(Z_INDEX_HIERARCHY.TOOLTIP).toBe(1100);
      expect(Z_INDEX_HIERARCHY.TOAST).toBe(1200);

      expect(Z_INDEX_LAYER_RANGES.BASE.min).toBe(0);
      expect(Z_INDEX_LAYER_RANGES.MODAL.min).toBe(1000);
      expect(Z_INDEX_LAYER_RANGES.MODAL.max).toBe(1099);
    });

    it("validates compliant overlay z-indices without violations", () => {
      const orchestrator = new OverlayOrchestrator();
      const overlays: OverlayDescriptor[] = [
        {
          id: "nav-dropdown",
          type: "menu",
          selector: ".dropdown-menu",
          zIndex: 850,
          hasBackdrop: false,
          dismissOnEscape: true,
          dismissOnBackdropClick: false,
        },
        {
          id: "confirm-modal",
          type: "modal",
          selector: "#modal-confirm",
          zIndex: 1000,
          hasBackdrop: true,
          backdropZIndex: 950,
          dismissOnEscape: true,
          dismissOnBackdropClick: true,
        },
        {
          id: "toast-alert",
          type: "toast",
          selector: ".toast-banner",
          zIndex: 1250,
          hasBackdrop: false,
          dismissOnEscape: true,
          dismissOnBackdropClick: false,
        },
      ];

      const violations = orchestrator.validateZIndexHierarchy(overlays);
      expect(violations.length).toBe(0);
    });

    it("detects z-index hierarchy violations when overlay or backdrop are out of range", () => {
      const orchestrator = new OverlayOrchestrator();
      const badOverlays: OverlayDescriptor[] = [
        {
          id: "rogue-modal",
          type: "modal",
          selector: "#modal-bad",
          zIndex: 50,
          hasBackdrop: true,
          backdropZIndex: 1050,
          dismissOnEscape: true,
          dismissOnBackdropClick: true,
        },
      ];

      const violations = orchestrator.validateZIndexHierarchy(badOverlays);
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations.some((v) => v.elementId === "rogue-modal")).toBe(true);
      expect(violations.some((v) => v.elementId === "rogue-modal-backdrop")).toBe(true);
    });

    it("throws HarnessError on invalid overlay arguments", () => {
      const orchestrator = new OverlayOrchestrator();
      expect(() => orchestrator.validateZIndexHierarchy(null as unknown as never)).toThrow(
        HarnessError,
      );
    });
  });
});

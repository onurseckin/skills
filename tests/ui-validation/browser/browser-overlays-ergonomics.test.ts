import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  HarnessError,
  OverlayOrchestrator,
  resetDefaultBrowserChoreographyEngine,
  type OverlayDescriptor,
} from "../fixtures.ts";

describe("Browser Choreography - Overlay Ergonomics & Occlusion", () => {
  beforeEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  afterEach(() => {
    resetDefaultBrowserChoreographyEngine();
  });

  describe("Backdrop Occlusion & Dismissal Ergonomics", () => {
    it("checks backdrop occlusion against background elements", () => {
      const orchestrator = new OverlayOrchestrator();
      const modal: OverlayDescriptor = {
        id: "modal-1",
        type: "modal",
        selector: "#m1",
        zIndex: 1000,
        hasBackdrop: true,
        backdropZIndex: 950,
        dismissOnEscape: true,
        dismissOnBackdropClick: true,
      };

      const bgElements = [
        { id: "header", zIndex: 100, bounds: { x: 0, y: 0, width: 1000, height: 60 } },
        { id: "rogue-button", zIndex: 980, bounds: { x: 10, y: 10, width: 100, height: 40 } },
      ];

      const occlusion = orchestrator.checkBackdropOcclusion(modal, bgElements);
      expect(occlusion.occludedCorrectly).toBe(false);
      expect(occlusion.occludingElements).toContain("rogue-button");
      expect(occlusion.violations.length).toBe(1);
    });

    it("verifies overlay dismissal ergonomics", () => {
      const orchestrator = new OverlayOrchestrator();
      const modal: OverlayDescriptor = {
        id: "settings-modal",
        type: "modal",
        selector: "#settings-modal",
        zIndex: 1000,
        hasBackdrop: true,
        dismissOnEscape: true,
        dismissOnBackdropClick: true,
        focusTrapActive: true,
      };

      const successErgonomics = orchestrator.verifyOverlayErgonomics(modal, {
        escapeDismisses: true,
        backdropClickDismisses: true,
        focusTrapped: true,
      });
      expect(successErgonomics.passed).toBe(true);
      expect(successErgonomics.violations.length).toBe(0);

      const failedErgonomics = orchestrator.verifyOverlayErgonomics(modal, {
        escapeDismisses: false,
        backdropClickDismisses: false,
        focusTrapped: false,
      });
      expect(failedErgonomics.passed).toBe(false);
      expect(failedErgonomics.violations.length).toBe(3);
    });

    it("throws HarnessError on invalid overlay arguments", () => {
      const orchestrator = new OverlayOrchestrator();
      expect(() => orchestrator.checkBackdropOcclusion(null as unknown as never, [])).toThrow(
        HarnessError,
      );
      expect(() => orchestrator.verifyOverlayErgonomics(null as unknown as never)).toThrow(
        HarnessError,
      );
    });
  });
});

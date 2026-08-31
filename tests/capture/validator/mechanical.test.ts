import { describe, expect, it } from "bun:test";
import {
  calculateApcaLightness,
  validateApcaElement,
} from "../../../olt/scripts/src/capture/validator/mechanical/apca.ts";
import { validateClsReservation } from "../../../olt/scripts/src/capture/validator/mechanical/cls-reservation.ts";
import { validateConcentricRadius } from "../../../olt/scripts/src/capture/validator/mechanical/concentric-radius.ts";
import { validateSidebarLayout } from "../../../olt/scripts/src/capture/validator/mechanical/sidebar-layout.ts";
import { validateSubpixelSnapping } from "../../../olt/scripts/src/capture/validator/mechanical/subpixel-snapping.ts";
import {
  validateTouchTargetClearance,
  validateTouchTargetDimensions,
} from "../../../olt/scripts/src/capture/validator/mechanical/touch-target.ts";
import { validateMechanical } from "../../../olt/scripts/src/capture/validator/mechanical/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Mechanical Validators", () => {
  describe("APCA Contrast (apca.ts)", () => {
    it("calculateApcaLightness computes contrast for light-on-dark, dark-on-light, near-black colors and zero contrast", () => {
      // Dark on Light (black text on white bg)
      const black = { r: 0, g: 0, b: 0, a: 1 };
      const white = { r: 255, g: 255, b: 255, a: 1 };
      const lcDarkOnLight = calculateApcaLightness(black, white);
      expect(lcDarkOnLight).toBeGreaterThan(100);

      // Light on Dark (white text on black bg)
      const lcLightOnDark = calculateApcaLightness(white, black);
      expect(lcLightOnDark).toBeLessThan(-100);

      // Near black adjustment (yTxt < 0.022 and yBg < 0.022)
      const nearBlack1 = { r: 2, g: 2, b: 2, a: 1 };
      const nearBlack2 = { r: 5, g: 5, b: 5, a: 1 };
      const lcNearBlack = calculateApcaLightness(nearBlack1, nearBlack2);
      expect(typeof lcNearBlack).toBe("number");

      // Identical colors return 0
      const gray = { r: 128, g: 128, b: 128, a: 1 };
      const lcZero = calculateApcaLightness(gray, gray);
      expect(lcZero).toBe(0);
    });

    it("validateApcaElement returns null for non-text or unparseable color elements", () => {
      // No text
      const elNoText: ElementPhysicsSnapshot = {
        selector: "div.box",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { color: "#000", backgroundColor: "#fff" },
      };
      expect(validateApcaElement(elNoText, 0)).toBeNull();

      // Empty / whitespace text
      const elEmptyText: ElementPhysicsSnapshot = {
        selector: "span.empty",
        tagName: "SPAN",
        text: "   ",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { color: "#000", backgroundColor: "#fff" },
      };
      expect(validateApcaElement(elEmptyText, 0)).toBeNull();

      // No styles
      const elNoStyles: ElementPhysicsSnapshot = {
        selector: "p.text",
        tagName: "P",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateApcaElement(elNoStyles, 0)).toBeNull();

      // Unparseable colors
      const elBadColors: ElementPhysicsSnapshot = {
        selector: "p.text",
        tagName: "P",
        text: "Hello",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        computedStyles: { color: "unknown", backgroundColor: "invalid" },
      };
      expect(validateApcaElement(elBadColors, 0)).toBeNull();
    });

    it("parses hex 3, 6, 8 digits, rgba, white, and black color formats", () => {
      // 3-digit hex & 8-digit hex
      const elHex38: ElementPhysicsSnapshot = {
        selector: "p.hex38",
        tagName: "P",
        text: "Sample text",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: {
          color: "#000",
          backgroundColor: "#ffffff80",
          fontSize: 16,
          fontWeight: 400,
        },
      };
      expect(typeof validateApcaElement(elHex38, 0)).toBe("object");

      // 6-digit hex & rgba
      const elHex6Rgba: ElementPhysicsSnapshot = {
        selector: "p.hex6rgba",
        tagName: "P",
        text: "Sample text",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: {
          color: "#112233",
          backgroundColor: "rgba(255, 255, 255, 1.0)",
          fontSize: 16,
          fontWeight: 400,
        },
      };
      expect(typeof validateApcaElement(elHex6Rgba, 0)).toBe("object");

      // named 'white' and 'black'
      const elNamed: ElementPhysicsSnapshot = {
        selector: "p.named",
        tagName: "P",
        text: "Sample text",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        computedStyles: {
          color: "black",
          backgroundColor: "white",
          fontSize: 16,
          fontWeight: 400,
        },
      };
      // High contrast passes
      expect(validateApcaElement(elNamed, 0)).toBeNull();
    });

    it("evaluates required Lc thresholds across font sizes and weights", () => {
      // Large text (>= 24px) requires Lc >= 60
      const elLargePass: ElementPhysicsSnapshot = {
        selector: "h1.large",
        tagName: "H1",
        text: "Large Heading",
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        computedStyles: {
          color: "#000000",
          backgroundColor: "#ffffff",
          fontSize: 24,
          fontWeight: 400,
        },
      };
      expect(validateApcaElement(elLargePass, 0)).toBeNull();

      // Bold medium text (>= 18px && bold) requires Lc >= 60
      const elBoldPass: ElementPhysicsSnapshot = {
        selector: "h2.bold",
        tagName: "H2",
        text: "Bold Title",
        bounds: { x: 0, y: 0, width: 200, height: 30 },
        computedStyles: {
          color: "#000000",
          backgroundColor: "#ffffff",
          fontSize: 18,
          fontWeight: 700,
        },
      };
      expect(validateApcaElement(elBoldPass, 0)).toBeNull();

      // Standard body text (>= 16px) requires Lc >= 75
      const elBodyFail: ElementPhysicsSnapshot = {
        selector: "p.body-low-contrast",
        tagName: "P",
        text: "Faint body text",
        bounds: { x: 0, y: 0, width: 200, height: 20 },
        computedStyles: {
          color: "#777777",
          backgroundColor: "#999999", // Low contrast Lc < 45
          fontSize: 16,
          fontWeight: 400,
        },
      };
      const defCritical = validateApcaElement(elBodyFail, 1);
      expect(defCritical).not.toBeNull();
      expect(defCritical?.severity).toBe("critical");
      expect(defCritical?.id).toBe("mech-apca-1");

      // Small text (< 16px, e.g. 14px) requires Lc >= 90
      const elSmallMedContrast: ElementPhysicsSnapshot = {
        selector: "span.caption",
        tagName: "SPAN",
        text: "Caption text",
        bounds: { x: 0, y: 0, width: 100, height: 16 },
        computedStyles: {
          color: "#333333",
          backgroundColor: "#cccccc", // Contrast Lc ~ 60 (below 90, but >= 45 -> serious)
          fontSize: 14,
          fontWeight: 400,
        },
      };
      const defSerious = validateApcaElement(elSmallMedContrast, 2);
      expect(defSerious).not.toBeNull();
      expect(defSerious?.severity).toBe("serious");
    });
  });

  describe("CLS Dimension Reservation (cls-reservation.ts)", () => {
    it("returns null for non-media elements", () => {
      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.container",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateClsReservation(elDiv, 0)).toBeNull();
    });

    it("identifies media elements by tag (IMG, VIDEO, IFRAME, CANVAS, OBJECT, EMBED) or role", () => {
      const mediaTags = ["IMG", "VIDEO", "IFRAME", "CANVAS", "OBJECT", "EMBED"];
      for (const tag of mediaTags) {
        const elFlawed: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.media`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 400, height: 300 },
        };
        const def = validateClsReservation(elFlawed, 0);
        expect(def).not.toBeNull();
        expect(def?.category).toBe("cls-reservation");
        expect(def?.severity).toBe("serious");
      }

      const elByRoleImg: ElementPhysicsSnapshot = {
        selector: "div.custom-img",
        tagName: "DIV",
        role: "img",
        bounds: { x: 0, y: 0, width: 400, height: 300 },
      };
      expect(validateClsReservation(elByRoleImg, 1)).not.toBeNull();

      const elByRoleVideo: ElementPhysicsSnapshot = {
        selector: "div.custom-video",
        tagName: "DIV",
        role: "video",
        bounds: { x: 0, y: 0, width: 400, height: 300 },
      };
      expect(validateClsReservation(elByRoleVideo, 2)).not.toBeNull();
    });

    it("passes media elements with aspect-ratio, metadata reservation, or HTML width/height attributes", () => {
      // CSS aspect-ratio
      const elAspect: ElementPhysicsSnapshot = {
        selector: "img.aspect",
        tagName: "IMG",
        bounds: { x: 0, y: 0, width: 400, height: 225 },
        computedStyles: { aspectRatio: "16 / 9" },
      };
      expect(validateClsReservation(elAspect, 0)).toBeNull();

      // ImageVideoMeta reservation flag
      const elMeta: ElementPhysicsSnapshot = {
        selector: "video.meta",
        tagName: "VIDEO",
        bounds: { x: 0, y: 0, width: 400, height: 225 },
        imageVideoMeta: { hasDimensionsReserved: true },
      };
      expect(validateClsReservation(elMeta, 0)).toBeNull();

      // HTML attributes
      const elAttrs: ElementPhysicsSnapshot = {
        selector: "img.attrs",
        tagName: "IMG",
        bounds: { x: 0, y: 0, width: 400, height: 225 },
        attributes: { width: "400", height: "225" },
      };
      expect(validateClsReservation(elAttrs, 0)).toBeNull();
    });
  });

  describe("Concentric Radii (concentric-radius.ts)", () => {
    it("returns null when parent or child has no border radius / padding specified", () => {
      const elPlain: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateConcentricRadius(elPlain, 0)).toBeNull();
    });

    it("validates element against its parent radii and padding", () => {
      // Passing case: child 8px, parent padding 8px -> expected parent 16px, actual parent 16px
      const elPass: ElementPhysicsSnapshot = {
        selector: "div.inner-card",
        tagName: "DIV",
        bounds: { x: 8, y: 8, width: 80, height: 80 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 16,
        parentPadding: 8,
      };
      expect(validateConcentricRadius(elPass, 0)).toBeNull();

      // Failing case: child 8px, padding 8px, parent 8px (diff is 8px > 2px)
      const elFail: ElementPhysicsSnapshot = {
        selector: "div.inner-card-bad",
        tagName: "DIV",
        bounds: { x: 8, y: 8, width: 80, height: 80 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 8,
        parentPadding: 8,
      };
      const def = validateConcentricRadius(elFail, 1);
      expect(def).not.toBeNull();
      expect(def?.id).toBe("mech-concentric-radius-1");
      expect(def?.severity).toBe("moderate");
      expect(def?.metadata?.actualOuterRadius).toBe(8);
      expect(def?.metadata?.expectedOuterRadius).toBe(16);
    });

    it("validates container against its children radii and padding", () => {
      // Container with valid concentric child
      const containerPass: ElementPhysicsSnapshot = {
        selector: "div.parent-card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        computedStyles: { borderRadius: 24, padding: 16 },
        children: [
          {
            selector: "div.child-card",
            tagName: "DIV",
            bounds: { x: 16, y: 16, width: 100, height: 100 },
            computedStyles: { borderRadius: 8 }, // 8 + 16 = 24
          },
        ],
      };
      expect(validateConcentricRadius(containerPass, 0)).toBeNull();

      // Container with mismatched child
      const containerFail: ElementPhysicsSnapshot = {
        selector: "div.parent-card-bad",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        computedStyles: { borderRadius: 12, padding: 16 }, // expected 8 + 16 = 24
        children: [
          undefined as unknown as ElementPhysicsSnapshot, // covers undefined child branch
          {
            selector: "div.child-bad",
            tagName: "DIV",
            bounds: { x: 16, y: 16, width: 100, height: 100 },
            computedStyles: { borderRadius: 8 },
          },
        ],
      };
      const def = validateConcentricRadius(containerFail, 2);
      expect(def).not.toBeNull();
      expect(def?.id).toBe("mech-concentric-radius-child-2-1");
      expect(def?.severity).toBe("moderate");
      expect(def?.metadata?.expectedOuterRadius).toBe(24);
    });
  });

  describe("Sidebar Layout (sidebar-layout.ts)", () => {
    it("returns empty array when sidebarConfig is undefined or not enabled", () => {
      expect(validateSidebarLayout([])).toEqual([]);
      expect(validateSidebarLayout([], { enabled: false })).toEqual([]);
    });

    it("detects top navbar violation when requireZeroNavbar is true", () => {
      const elements: (ElementPhysicsSnapshot | undefined)[] = [
        undefined, // covers undefined slot
        {
          selector: "header.top-nav",
          tagName: "HEADER",
          bounds: { x: 0, y: 0, width: 1200, height: 60 },
        },
      ];

      const defects = validateSidebarLayout(
        elements as unknown as ElementPhysicsSnapshot[],
        { enabled: true, requireZeroNavbar: true },
        { width: 1280, height: 800 },
      );
      expect(defects.length).toBe(1);
      expect(defects[0]?.category).toBe("sidebar-layout");
      expect(defects[0]?.id).toBe("mech-sidebar-navbar-found-1");
      expect(defects[0]?.severity).toBe("serious");
    });

    it("checks sidebar container width with custom container selector and fallback ASIDE", () => {
      // Custom selector under minWidth
      const elCustom: ElementPhysicsSnapshot = {
        selector: "div.custom-nav-drawer",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 180, height: 800 },
      };
      const defCustom = validateSidebarLayout([elCustom], {
        enabled: true,
        minWidth: 240,
        selectors: { container: "div.custom-nav-drawer" },
      });
      expect(defCustom.length).toBe(1);
      expect(defCustom[0]?.id).toBe("mech-sidebar-width-under");

      // Fallback ASIDE when selector is omitted
      const elUnder: ElementPhysicsSnapshot = {
        selector: "aside.sidebar",
        tagName: "ASIDE",
        bounds: { x: 0, y: 0, width: 180, height: 800 },
      };
      const defUnder = validateSidebarLayout([elUnder], {
        enabled: true,
        minWidth: 240,
        maxWidth: 320,
      });
      expect(defUnder.length).toBe(1);
      expect(defUnder[0]?.id).toBe("mech-sidebar-width-under");
      expect(defUnder[0]?.metadata?.actualWidth).toBe(180);

      // Over maxWidth
      const elOver: ElementPhysicsSnapshot = {
        selector: "aside.sidebar-wide",
        tagName: "ASIDE",
        bounds: { x: 0, y: 0, width: 400, height: 800 },
      };
      const defOver = validateSidebarLayout([elOver], {
        enabled: true,
        minWidth: 200,
        maxWidth: 300,
      });
      expect(defOver.length).toBe(1);
      expect(defOver[0]?.id).toBe("mech-sidebar-width-over");
      expect(defOver[0]?.metadata?.actualWidth).toBe(400);

      // Container not found in elements
      const defNotFound = validateSidebarLayout([], {
        enabled: true,
        minWidth: 200,
      });
      expect(defNotFound.length).toBe(0);
    });

    it("validates logo position with explicit selector and fallback testid", () => {
      // Explicit selector
      const elLogoValid: ElementPhysicsSnapshot = {
        selector: "img.app-logo",
        tagName: "IMG",
        bounds: { x: 24, y: 24, width: 120, height: 32 },
      };
      const defPass = validateSidebarLayout([elLogoValid], {
        enabled: true,
        logoPosition: "top-left",
        selectors: { logo: "img.app-logo" },
      });
      expect(defPass.length).toBe(0);

      // Fallback selector by data-testid="logo"
      const elLogoTestId: ElementPhysicsSnapshot = {
        selector: "svg.custom-brand",
        tagName: "SVG",
        attributes: { "data-testid": "logo" },
        bounds: { x: 150, y: 120, width: 120, height: 32 },
      };
      const defFailTestId = validateSidebarLayout([elLogoTestId], {
        enabled: true,
        logoPosition: "top-left",
      });
      expect(defFailTestId.length).toBe(1);
      expect(defFailTestId[0]?.id).toBe("mech-sidebar-logo-pos");
    });

    it("validates user profile position with explicit selector and fallback user-avatar", () => {
      // Explicit selector valid
      const elProfileValid: ElementPhysicsSnapshot = {
        selector: "div.user-profile",
        tagName: "DIV",
        bounds: { x: 24, y: 650, width: 200, height: 50 },
      };
      const defPass = validateSidebarLayout(
        [elProfileValid],
        {
          enabled: true,
          userProfilePosition: "bottom-left",
          selectors: { userProfile: "div.user-profile" },
        },
        { width: 1280, height: 800 },
      );
      expect(defPass.length).toBe(0);

      // Fallback selector by class user-avatar
      const elAvatarBad: ElementPhysicsSnapshot = {
        selector: "div.user-avatar",
        tagName: "DIV",
        bounds: { x: 150, y: 200, width: 200, height: 50 },
      };
      const defFailAvatar = validateSidebarLayout(
        [elAvatarBad],
        { enabled: true, userProfilePosition: "bottom-left" },
        { width: 1280, height: 800 },
      );
      expect(defFailAvatar.length).toBe(1);
      expect(defFailAvatar[0]?.id).toBe("mech-sidebar-profile-pos");
    });
  });

  describe("Subpixel Snapping (subpixel-snapping.ts)", () => {
    it("returns null when element bounds and transforms are integer aligned", () => {
      const elAligned: ElementPhysicsSnapshot = {
        selector: "div.snapped",
        tagName: "DIV",
        bounds: { x: 10, y: 20, width: 100, height: 200 },
        computedStyles: { transform: "translate(10px, 20px)" },
      };
      expect(validateSubpixelSnapping(elAligned, 0)).toBeNull();
    });

    it("detects fractional bounds (x, y, width, height)", () => {
      const elFracBounds: ElementPhysicsSnapshot = {
        selector: "div.frac-bounds",
        tagName: "DIV",
        bounds: { x: 10.33, y: 20.45, width: 100.25, height: 200.75 },
      };
      const defect = validateSubpixelSnapping(elFracBounds, 1);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("mech-subpixel-1");
      expect(defect?.severity).toBe("minor");
      expect(defect?.message).toContain("x=10.33px");
      expect(defect?.message).toContain("y=20.45px");
      expect(defect?.message).toContain("width=100.25px");
      expect(defect?.message).toContain("height=200.75px");
    });

    it("detects fractional transforms in matrix and translate3d notations", () => {
      // Matrix with fractional translation tx, ty
      const elMatrix: ElementPhysicsSnapshot = {
        selector: "div.matrix-frac",
        tagName: "DIV",
        bounds: { x: 10, y: 20, width: 100, height: 100 },
        computedStyles: { transform: "matrix(1, 0, 0, 1, 10.35, 20.65)" },
      };
      const defMatrix = validateSubpixelSnapping(elMatrix, 2);
      expect(defMatrix).not.toBeNull();
      expect(defMatrix?.message).toContain("transform=10.35px");
      expect(defMatrix?.message).toContain("transform=20.65px");

      // Translate3d with fractional values
      const elTranslate: ElementPhysicsSnapshot = {
        selector: "div.translate-frac",
        tagName: "DIV",
        bounds: { x: 10, y: 20, width: 100, height: 100 },
        computedStyles: { transform: "translate3d(15.4px, 25.8px, 0px)" },
      };
      const defTranslate = validateSubpixelSnapping(elTranslate, 3);
      expect(defTranslate).not.toBeNull();
      expect(defTranslate?.message).toContain("transform=15.40px");
      expect(defTranslate?.message).toContain("transform=25.80px");
    });
  });

  describe("Touch Target Dimensions & Clearance (touch-target.ts)", () => {
    it("validateTouchTargetDimensions returns null for non-interactive or zero-size elements", () => {
      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.box",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 20, height: 20 },
      };
      expect(validateTouchTargetDimensions(elDiv, 0)).toBeNull();

      const elZero: ElementPhysicsSnapshot = {
        selector: "button.zero",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      };
      expect(validateTouchTargetDimensions(elZero, 0)).toBeNull();
    });

    it("identifies interactive tags and checks minimum 44x44px dimensions", () => {
      const tags = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"];
      for (const tag of tags) {
        const elOk: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.ok`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 48, height: 48 },
        };
        expect(validateTouchTargetDimensions(elOk, 0)).toBeNull();
      }

      // Serious defect: dimension between 24 and 44px
      const elSerious: ElementPhysicsSnapshot = {
        selector: "button.medium",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 32, height: 32 },
      };
      const defSerious = validateTouchTargetDimensions(elSerious, 1);
      expect(defSerious).not.toBeNull();
      expect(defSerious?.severity).toBe("serious");

      // Critical defect: dimension < 24px
      const elCritical: ElementPhysicsSnapshot = {
        selector: "button.tiny",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 16, height: 16 },
      };
      const defCritical = validateTouchTargetDimensions(elCritical, 2);
      expect(defCritical).not.toBeNull();
      expect(defCritical?.severity).toBe("critical");
    });

    it("validateTouchTargetClearance flags overlapping or crowded interactive targets", () => {
      const crowdedTargets: (ElementPhysicsSnapshot | undefined)[] = [
        undefined, // covers undefined target branch
        {
          selector: "button.btn-a",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 10, y: 10, width: 44, height: 44 },
        },
        {
          selector: "button.btn-b",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 20, y: 20, width: 44, height: 44 }, // heavy overlap
        },
      ];

      const defects = validateTouchTargetClearance(
        crowdedTargets as unknown as ElementPhysicsSnapshot[],
      );
      expect(defects.length).toBeGreaterThan(0);
      expect(defects[0]?.category).toBe("touch-target");
      expect(defects[0]?.severity).toBe("serious");
      expect(defects[0]?.message).toContain("insufficient circular clearance");
    });
  });

  describe("Mechanical Aggregate (validateMechanical)", () => {
    it("evaluates empty elements list cleanly", () => {
      const ctx: ValidationContext = {
        screenId: "test_mech",
        viewport: "desktop",
        elements: [],
      };
      const res = validateMechanical(ctx);
      expect(res.pillar).toBe("mechanical");
      expect(res.passed).toBe(true);
      expect(res.defects.length).toBe(0);
      expect(res.evaluatedCount).toBe(0);
    });

    it("handles undefined slots and aggregates defects across all mechanical categories", () => {
      const elements: (ElementPhysicsSnapshot | undefined)[] = [
        undefined, // covers if (!el) continue
        {
          selector: "p.low-apca",
          tagName: "P",
          text: "Unreadable",
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          computedStyles: {
            color: "#888888",
            backgroundColor: "#999999",
            fontSize: 16,
          },
        },
        {
          selector: "button.tiny-btn",
          tagName: "BUTTON",
          bounds: { x: 0, y: 0, width: 20, height: 20 },
        },
        {
          selector: "div.bad-radius",
          tagName: "DIV",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          computedStyles: { borderRadius: 8 },
          parentBorderRadius: 8,
          parentPadding: 8,
        },
        {
          selector: "div.subpixel-el",
          tagName: "DIV",
          bounds: { x: 10.33, y: 20.33, width: 100, height: 100 },
        },
        {
          selector: "img.unreserved-img",
          tagName: "IMG",
          bounds: { x: 0, y: 0, width: 300, height: 200 },
        },
      ];

      const ctx: ValidationContext = {
        screenId: "mech_screen",
        viewport: "desktop",
        elements: elements as unknown as ElementPhysicsSnapshot[],
      };

      const res = validateMechanical(ctx);
      expect(res.pillar).toBe("mechanical");
      expect(res.passed).toBe(false);
      expect(res.evaluatedCount).toBe(elements.length);
      expect(res.defects.length).toBeGreaterThanOrEqual(5);

      const categories = res.defects.map((d) => d.category);
      expect(categories).toContain("apca-contrast");
      expect(categories).toContain("touch-target");
      expect(categories).toContain("concentric-radius");
      expect(categories).toContain("subpixel-snapping");
      expect(categories).toContain("cls-reservation");
    });
  });
});

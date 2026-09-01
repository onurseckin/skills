import { describe, expect, it } from "bun:test";
import { validateClsReservation } from "../../../olt/scripts/src/capture/validator/mechanical/cls-reservation.ts";
import { validateConcentricRadius } from "../../../olt/scripts/src/capture/validator/mechanical/concentric-radius.ts";
import { validateSidebarLayout } from "../../../olt/scripts/src/capture/validator/mechanical/sidebar-layout.ts";
import { validateSubpixelSnapping } from "../../../olt/scripts/src/capture/validator/mechanical/subpixel-snapping.ts";
import { validateMechanical } from "../../../olt/scripts/src/capture/validator/mechanical/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Mechanical Validators: Spacing, Typography & Layout Aggregate", () => {
  describe("CLS Dimension Reservation (cls-reservation.ts)", () => {
    it("returns null for non-media elements", () => {
      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.container",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateClsReservation(elDiv, 0)).toBeNull();
    });

    it("identifies media elements and validates dimension reservations", () => {
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

      const elAspect: ElementPhysicsSnapshot = {
        selector: "img.aspect",
        tagName: "IMG",
        bounds: { x: 0, y: 0, width: 400, height: 225 },
        computedStyles: { aspectRatio: "16 / 9" },
      };
      expect(validateClsReservation(elAspect, 0)).toBeNull();

      const elMeta: ElementPhysicsSnapshot = {
        selector: "video.meta",
        tagName: "VIDEO",
        bounds: { x: 0, y: 0, width: 400, height: 225 },
        imageVideoMeta: { hasDimensionsReserved: true },
      };
      expect(validateClsReservation(elMeta, 0)).toBeNull();

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
    it("validates element and container concentric radii", () => {
      const elPass: ElementPhysicsSnapshot = {
        selector: "div.inner-card",
        tagName: "DIV",
        bounds: { x: 8, y: 8, width: 80, height: 80 },
        computedStyles: { borderRadius: 8 },
        parentBorderRadius: 16,
        parentPadding: 8,
      };
      expect(validateConcentricRadius(elPass, 0)).toBeNull();

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
      expect(def?.category).toBe("concentric-radius");
      expect(def?.metadata?.expectedOuterRadius).toBe(16);

      const containerFail: ElementPhysicsSnapshot = {
        selector: "div.parent-card-bad",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        computedStyles: { borderRadius: 12, padding: 16 },
        children: [
          undefined as unknown as ElementPhysicsSnapshot,
          {
            selector: "div.child-bad",
            tagName: "DIV",
            bounds: { x: 16, y: 16, width: 100, height: 100 },
            computedStyles: { borderRadius: 8 },
          },
        ],
      };
      const defContainer = validateConcentricRadius(containerFail, 2);
      expect(defContainer).not.toBeNull();
      expect(defContainer?.metadata?.expectedOuterRadius).toBe(24);
    });
  });

  describe("Sidebar Layout (sidebar-layout.ts)", () => {
    it("validates sidebar container width, navbar restrictions, and logo/profile positions", () => {
      expect(validateSidebarLayout([])).toEqual([]);
      expect(validateSidebarLayout([], { enabled: false })).toEqual([]);

      const elHeader: ElementPhysicsSnapshot = {
        selector: "header.top-nav",
        tagName: "HEADER",
        bounds: { x: 0, y: 0, width: 1200, height: 60 },
      };
      const defNav = validateSidebarLayout(
        [elHeader],
        { enabled: true, requireZeroNavbar: true },
        { width: 1280, height: 800 },
      );
      expect(defNav.length).toBe(1);

      const elAside: ElementPhysicsSnapshot = {
        selector: "aside.sidebar",
        tagName: "ASIDE",
        bounds: { x: 0, y: 0, width: 280, height: 800 },
      };
      expect(
        validateSidebarLayout([elAside], { enabled: true, minWidth: 240, maxWidth: 320 }).length,
      ).toBe(0);
      expect(validateSidebarLayout([elAside], { enabled: true, minWidth: 300 }).length).toBe(1);

      const elOver: ElementPhysicsSnapshot = {
        selector: "aside.sidebar-wide",
        tagName: "ASIDE",
        bounds: { x: 0, y: 0, width: 400, height: 800 },
      };
      expect(validateSidebarLayout([elOver], { enabled: true, maxWidth: 320 }).length).toBe(1);

      const elLogo: ElementPhysicsSnapshot = {
        selector: "img.logo",
        tagName: "IMG",
        bounds: { x: 200, y: 200, width: 100, height: 40 },
      };
      expect(
        validateSidebarLayout([elLogo], { enabled: true, logoPosition: "top-left" }).length,
      ).toBe(1);

      const elProfile: ElementPhysicsSnapshot = {
        selector: "div.user-profile",
        tagName: "DIV",
        bounds: { x: 200, y: 200, width: 100, height: 40 },
      };
      expect(
        validateSidebarLayout(
          [elProfile],
          { enabled: true, userProfilePosition: "bottom-left" },
          { width: 1280, height: 800 },
        ).length,
      ).toBe(1);
    });
  });

  describe("Subpixel Snapping (subpixel-snapping.ts)", () => {
    it("detects fractional bounds and fractional transforms", () => {
      const elFrac: ElementPhysicsSnapshot = {
        selector: "div.frac",
        tagName: "DIV",
        bounds: { x: 10.33, y: 20.45, width: 100.25, height: 200.75 },
      };
      const defFrac = validateSubpixelSnapping(elFrac, 1);
      expect(defFrac).not.toBeNull();
      expect(defFrac?.category).toBe("subpixel-snapping");

      const elTrans: ElementPhysicsSnapshot = {
        selector: "div.trans",
        tagName: "DIV",
        bounds: { x: 10, y: 20, width: 100, height: 100 },
        computedStyles: { transform: "matrix(1, 0, 0, 1, 10.35, 20.65)" },
      };
      const defTrans = validateSubpixelSnapping(elTrans, 2);
      expect(defTrans).not.toBeNull();
    });
  });

  describe("Mechanical Aggregate (validateMechanical)", () => {
    it("evaluates empty elements cleanly and aggregates defects across categories", () => {
      const ctxClean: ValidationContext = {
        screenId: "test_mech",
        viewport: "desktop",
        elements: [],
      };
      const resClean = validateMechanical(ctxClean);
      expect(resClean.pillar).toBe("mechanical");
      expect(resClean.passed).toBe(true);

      const elements: ElementPhysicsSnapshot[] = [
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
          selector: "img.unreserved-img",
          tagName: "IMG",
          bounds: { x: 0, y: 0, width: 300, height: 200 },
        },
      ];

      const ctxFlawed: ValidationContext = {
        screenId: "mech_screen",
        viewport: "desktop",
        elements,
      };

      const resFlawed = validateMechanical(ctxFlawed);
      expect(resFlawed.passed).toBe(false);
      expect(resFlawed.defects.length).toBeGreaterThanOrEqual(3);
    });
  });
});

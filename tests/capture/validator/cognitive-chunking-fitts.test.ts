import { describe, expect, it } from "bun:test";
import {
  calculateFittsId,
  validateCowanChunking,
  validateFittsLaw,
} from "../../../olt/scripts/src/capture/validator/cognitive/index.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Cognitive Validators: Cowan Chunking & Fitts's Law", () => {
  describe("Cowan Working Memory 4±1 Chunking (cowan-chunking.ts)", () => {
    it("returns null for elements without children or non-container tags", () => {
      const elNoChildren: ElementPhysicsSnapshot = {
        selector: "nav.main",
        tagName: "NAV",
        bounds: { x: 0, y: 0, width: 200, height: 400 },
      };
      expect(validateCowanChunking(elNoChildren, 0)).toBeNull();

      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.wrapper",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 200, height: 400 },
        children: Array.from({ length: 8 }, (_, i) => ({
          selector: `span.child-${i}`,
          tagName: "SPAN",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      expect(validateCowanChunking(elDiv, 0)).toBeNull();
    });

    it("evaluates containers (NAV, SECTION, UL, OL, MENU, role navigation/menu/list)", () => {
      const containerTags = ["NAV", "SECTION", "UL", "OL", "MENU"];
      for (const tag of containerTags) {
        const elPass: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.nav`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 200, height: 300 },
          children: Array.from({ length: 4 }, (_, i) => ({
            selector: `div.item-${i}`,
            tagName: "DIV",
            bounds: { x: 0, y: i * 30, width: 100, height: 30 },
          })),
        };
        expect(validateCowanChunking(elPass, 0)).toBeNull();

        const elFail: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.dense`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 200, height: 300 },
          children: Array.from({ length: 8 }, (_, i) => ({
            selector: `div.item-${i}`,
            tagName: "DIV",
            bounds: { x: 0, y: i * 30, width: 100, height: 30 },
          })),
        };
        const def = validateCowanChunking(elFail, 1);
        expect(def).not.toBeNull();
        expect(def?.id).toBe("cog-cowan-1");
        expect(def?.severity).toBe("moderate");
        expect(def?.metadata?.itemCount).toBe(8);
      }

      const elByRole: ElementPhysicsSnapshot = {
        selector: "div.nav-role",
        tagName: "DIV",
        role: "navigation",
        bounds: { x: 0, y: 0, width: 200, height: 300 },
        children: Array.from({ length: 9 }, (_, i) => ({
          selector: `a.link-${i}`,
          tagName: "A",
          bounds: { x: 0, y: i * 30, width: 100, height: 30 },
        })),
      };
      expect(validateCowanChunking(elByRole, 2)).not.toBeNull();
    });
  });

  describe("Fitts's Law Index of Difficulty (fitts-law.ts)", () => {
    it("calculateFittsId computes accurate difficulty bits and boundary conditions", () => {
      expect(calculateFittsId(100, 100, 40, 40, 120, 120)).toBe(0);

      const id = calculateFittsId(500, 500, 40, 40, 0, 0);
      expect(id).toBeGreaterThan(4.0);

      expect(calculateFittsId(0, 0, 100, 100, 45, 45)).toBe(0);
      expect(calculateFittsId(10, 10, 20, 20, 20, 20)).toBe(0);
    });

    it("validateFittsLaw checks buttons and interactive controls against 5.5 bit threshold", () => {
      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.banner",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateFittsLaw(elDiv, 0)).toBeNull();

      const elBtnPass: ElementPhysicsSnapshot = {
        selector: "button.submit",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 600, y: 400, width: 120, height: 44 },
      };
      expect(validateFittsLaw(elBtnPass, 0, { width: 1280, height: 800 })).toBeNull();

      const elBtnFar: ElementPhysicsSnapshot = {
        selector: "button.tiny-corner",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 2, y: 2, width: 12, height: 12 },
      };
      const defect = validateFittsLaw(elBtnFar, 1, { width: 1920, height: 1080 });
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cog-fitts-1");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.message).toContain("Index of Difficulty");
      expect(defect?.metadata?.indexOfDifficultyBits).toBeGreaterThan(5.5);

      const defFallback = validateFittsLaw(elBtnFar, 2);
      expect(defFallback).not.toBeNull();
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  validateTouchTargetClearance,
  validateTouchTargetDimensions,
} from "../../../olt/scripts/src/capture/validator/mechanical/touch-target.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Mechanical Validators: Touch Target Dimensions & Clearance", () => {
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

    const elSerious: ElementPhysicsSnapshot = {
      selector: "button.medium",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 32, height: 32 },
    };
    const defSerious = validateTouchTargetDimensions(elSerious, 1);
    expect(defSerious).not.toBeNull();
    expect(defSerious?.severity).toBe("serious");

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
      undefined,
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
        bounds: { x: 20, y: 20, width: 44, height: 44 },
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

import { describe, expect, it } from "bun:test";
import { validateMaterialStateLayers } from "../../../olt/scripts/src/capture/validator/custom/material-state-layers.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: Material Design 3 State Layers", () => {
  it("returns null if element has no stateLayers", () => {
    const el: ElementPhysicsSnapshot = {
      selector: "button.plain",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
    };
    expect(validateMaterialStateLayers(el, 0)).toBeNull();
  });

  it("passes when state layer opacities match MD3 specification exactly or within tolerance", () => {
    const elHover: ElementPhysicsSnapshot = {
      selector: "button.btn-hover",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      stateLayers: { hover: 0.08 },
    };
    expect(validateMaterialStateLayers(elHover, 0)).toBeNull();

    const elFocus: ElementPhysicsSnapshot = {
      selector: "button.btn-focus",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      stateLayers: { focus: 0.12 },
    };
    expect(validateMaterialStateLayers(elFocus, 0)).toBeNull();

    const elPressed: ElementPhysicsSnapshot = {
      selector: "button.btn-pressed",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      stateLayers: { pressed: 0.12 },
    };
    expect(validateMaterialStateLayers(elPressed, 0)).toBeNull();

    const elDragged: ElementPhysicsSnapshot = {
      selector: "button.btn-dragged",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      stateLayers: { dragged: 0.16 },
    };
    expect(validateMaterialStateLayers(elDragged, 0)).toBeNull();
  });

  it("detects invalid state layer opacities (e.g. hover = 0.5)", () => {
    const elBadHover: ElementPhysicsSnapshot = {
      selector: "button.bad-hover",
      tagName: "BUTTON",
      bounds: { x: 0, y: 0, width: 100, height: 40 },
      stateLayers: { hover: 0.5 },
    };
    const def = validateMaterialStateLayers(elBadHover, 1);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-md3-layers-1");
    expect(def?.severity).toBe("moderate");
    expect(def?.message).toContain("Material Design 3 state layer deviation");
  });
});

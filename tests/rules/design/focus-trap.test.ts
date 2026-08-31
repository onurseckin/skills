import { describe, expect, it } from "bun:test";
import { validateWaiAriaFocusTrap } from "../../../olt/scripts/src/capture/validator/custom/wai-aria-focus-trap.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Design Rule: WAI-ARIA Focus Trap", () => {
  it("returns null for non-modal elements", () => {
    const elNormal: ElementPhysicsSnapshot = {
      selector: "div.panel",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(validateWaiAriaFocusTrap(elNormal, 0)).toBeNull();
  });

  it("identifies trapped modal elements by attributes or flags", () => {
    const elDialog: ElementPhysicsSnapshot = {
      selector: "dialog.modal-dialog",
      tagName: "DIALOG",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      hasTrapFocus: true,
      attributes: { "aria-modal": "true" },
    };
    expect(validateWaiAriaFocusTrap(elDialog, 0)).toBeNull();
  });

  it("flags modal dialog missing active focus trap", () => {
    const elMissingTrap: ElementPhysicsSnapshot = {
      selector: "dialog.unconstrained",
      tagName: "DIALOG",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
    };
    const def = validateWaiAriaFocusTrap(elMissingTrap, 1);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-aria-trap-1");
    expect(def?.severity).toBe("critical");
    expect(def?.message).toContain("missing WAI-ARIA 1.2 / Radix UI focus trap");
  });

  it("flags composite widgets missing roving tabindex", () => {
    const elTablist: ElementPhysicsSnapshot = {
      selector: "div.tabs-header",
      tagName: "DIV",
      role: "tablist",
      bounds: { x: 0, y: 0, width: 500, height: 40 },
    };
    const def = validateWaiAriaFocusTrap(elTablist, 2);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-aria-roving-2");
    expect(def?.severity).toBe("serious");
    expect(def?.message).toContain("lacks roving tabindex");
  });
});

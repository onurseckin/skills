import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateWaiAriaFocusTrap } from "../../../olt/scripts/src/capture/validator/custom/wai-aria-focus-trap.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";
import { cleanupVirtualRulesFS, setupVirtualRulesFS } from "../fixture.ts";

describe("Design Rule: WAI-ARIA Focus Trap", () => {
  beforeEach(() => {
    setupVirtualRulesFS();
  });

  afterEach(() => {
    cleanupVirtualRulesFS();
  });

  it("returns null for non-modal elements", () => {
    const elNormal: ElementPhysicsSnapshot = {
      selector: "div.panel",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(validateWaiAriaFocusTrap(elNormal, 0)).toBeNull();
  });

  it("identifies trapped modal elements by attributes or flags independently", () => {
    // Satisfied via hasTrapFocus only
    const elWithTrapOnly: ElementPhysicsSnapshot = {
      selector: "dialog.trap-only",
      tagName: "DIALOG",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      hasTrapFocus: true,
    };
    expect(validateWaiAriaFocusTrap(elWithTrapOnly, 0)).toBeNull();

    // Satisfied via aria-modal attribute only
    const elWithAriaModalOnly: ElementPhysicsSnapshot = {
      selector: "div.role-dialog-modal",
      tagName: "DIV",
      role: "dialog",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      attributes: { "aria-modal": "true" },
    };
    expect(validateWaiAriaFocusTrap(elWithAriaModalOnly, 1)).toBeNull();

    // Satisfied for alertdialog role
    const elAlertDialog: ElementPhysicsSnapshot = {
      selector: "div.alert-dialog",
      tagName: "DIV",
      role: "alertdialog",
      bounds: { x: 0, y: 0, width: 400, height: 200 },
      hasTrapFocus: true,
    };
    expect(validateWaiAriaFocusTrap(elAlertDialog, 2)).toBeNull();
  });

  it("safely handles undefined and optional properties without TypeError", () => {
    const elBare: ElementPhysicsSnapshot = {
      selector: "span.bare",
      tagName: "SPAN",
      bounds: { x: 0, y: 0, width: 50, height: 20 },
      role: undefined,
      attributes: undefined,
      hasTrapFocus: undefined,
      hasRovingTabindex: undefined,
    };
    expect(validateWaiAriaFocusTrap(elBare, 99)).toBeNull();

    // Dialog with undefined attributes and trap flags triggers defect cleanly
    const elDialogBare: ElementPhysicsSnapshot = {
      selector: "dialog.bare",
      tagName: "DIALOG",
      bounds: { x: 0, y: 0, width: 50, height: 20 },
      role: undefined,
      attributes: undefined,
      hasTrapFocus: undefined,
    };
    const def = validateWaiAriaFocusTrap(elDialogBare, 100);
    expect(def).not.toBeNull();
    expect(def?.id).toBe("cust-aria-trap-100");
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

  it("flags composite widgets missing roving tabindex or active descendant", () => {
    const compositeRoles = ["tablist", "menu", "menubar", "radiogroup", "grid", "tree"];

    for (let i = 0; i < compositeRoles.length; i++) {
      const role = compositeRoles[i]!;
      const elMissingRoving: ElementPhysicsSnapshot = {
        selector: `div.${role}-component`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 500, height: 40 },
      };
      const def = validateWaiAriaFocusTrap(elMissingRoving, i + 10);
      expect(def).not.toBeNull();
      expect(def?.id).toBe(`cust-aria-roving-${i + 10}`);
      expect(def?.severity).toBe("serious");
      expect(def?.message).toContain(`role="${role}" lacks roving tabindex`);
    }
  });

  it("accepts composite widgets with roving tabindex or aria-activedescendant", () => {
    // Satisfied via hasRovingTabindex
    const elWithRoving: ElementPhysicsSnapshot = {
      selector: "div.menu-roving",
      tagName: "DIV",
      role: "menu",
      hasRovingTabindex: true,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    };
    expect(validateWaiAriaFocusTrap(elWithRoving, 30)).toBeNull();

    // Satisfied via aria-activedescendant
    const elWithDescendant: ElementPhysicsSnapshot = {
      selector: "div.grid-active-descendant",
      tagName: "DIV",
      role: "grid",
      attributes: { "aria-activedescendant": "cell-0-0" },
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    };
    expect(validateWaiAriaFocusTrap(elWithDescendant, 31)).toBeNull();
  });
});

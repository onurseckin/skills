import { describe, expect, it } from "bun:test";
import {
  calculateHickHymanEntropy,
  validateHickHyman,
  validateNormanRecovery,
} from "../../../olt/scripts/src/capture/validator/cognitive/index.ts";
import type { ElementPhysicsSnapshot } from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Cognitive Validators: Hick-Hyman & Don Norman Recovery", () => {
  describe("Hick-Hyman Decision Entropy (hick-hyman.ts)", () => {
    it("calculateHickHymanEntropy computes entropy bits for items", () => {
      expect(calculateHickHymanEntropy(0)).toBe(0);
      expect(calculateHickHymanEntropy(-5)).toBe(0);
      expect(calculateHickHymanEntropy(1)).toBeCloseTo(1.0, 4);
      expect(calculateHickHymanEntropy(7)).toBeCloseTo(3.0, 4);
    });

    it("validateHickHyman checks choice containers (menu, listbox, SELECT, dropdown, etc.)", () => {
      const elEmpty: ElementPhysicsSnapshot = {
        selector: "select.country",
        tagName: "SELECT",
        bounds: { x: 0, y: 0, width: 150, height: 36 },
      };
      expect(validateHickHyman(elEmpty, 0)).toBeNull();

      const elChoicePass: ElementPhysicsSnapshot = {
        selector: "select.size",
        tagName: "SELECT",
        bounds: { x: 0, y: 0, width: 150, height: 36 },
        children: Array.from({ length: 5 }, (_, i) => ({
          selector: `option.opt-${i}`,
          tagName: "OPTION",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      expect(validateHickHyman(elChoicePass, 0)).toBeNull();

      const elChoiceFail: ElementPhysicsSnapshot = {
        selector: "ul.dropdown-options",
        tagName: "UL",
        role: "listbox",
        bounds: { x: 0, y: 0, width: 200, height: 300 },
        children: Array.from({ length: 15 }, (_, i) => ({
          selector: `li.opt-${i}`,
          tagName: "LI",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      const defect = validateHickHyman(elChoiceFail, 1);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cog-hick-hyman-1");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.metadata?.optionCount).toBe(15);
      expect(defect?.metadata?.entropyBits).toBeGreaterThan(3.5);
    });
  });

  describe("Don Norman Error Recovery Grace Periods (norman-recovery.ts)", () => {
    it("returns null for non-destructive actions", () => {
      const elSave: ElementPhysicsSnapshot = {
        selector: "button.save",
        tagName: "BUTTON",
        text: "Save Changes",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
      };
      expect(validateNormanRecovery(elSave, 0)).toBeNull();
    });

    it("identifies destructive actions by keyword or isDestructive flag", () => {
      const keywords = [
        "delete",
        "remove",
        "destroy",
        "drop",
        "purge",
        "terminate",
        "wipe",
        "discard",
      ];
      for (const kw of keywords) {
        const elText: ElementPhysicsSnapshot = {
          selector: "button.action",
          tagName: "BUTTON",
          text: `Please ${kw} record`,
          bounds: { x: 0, y: 0, width: 120, height: 40 },
        };
        const defText = validateNormanRecovery(elText, 0);
        expect(defText).not.toBeNull();
        expect(defText?.category).toBe("norman-grace");

        const elSelector: ElementPhysicsSnapshot = {
          selector: `button.btn-${kw}`,
          tagName: "BUTTON",
          bounds: { x: 0, y: 0, width: 120, height: 40 },
        };
        expect(validateNormanRecovery(elSelector, 0)).not.toBeNull();
      }

      const elFlag: ElementPhysicsSnapshot = {
        selector: "button.custom",
        tagName: "BUTTON",
        isDestructive: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elFlag, 0)).not.toBeNull();
    });

    it("passes destructive actions with confirmation dialog or undo grace period", () => {
      const elConfirmed: ElementPhysicsSnapshot = {
        selector: "button.delete",
        tagName: "BUTTON",
        text: "Delete Project",
        hasConfirmation: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elConfirmed, 0)).toBeNull();

      const elUndo: ElementPhysicsSnapshot = {
        selector: "button.remove",
        tagName: "BUTTON",
        text: "Remove Item",
        hasUndo: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elUndo, 0)).toBeNull();
    });

    it("elevates severity to critical for account or bulk destruction without safety", () => {
      const elAccount: ElementPhysicsSnapshot = {
        selector: "button.delete-account",
        tagName: "BUTTON",
        text: "Delete Account and Billing Data",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };
      const defAccount = validateNormanRecovery(elAccount, 1);
      expect(defAccount).not.toBeNull();
      expect(defAccount?.severity).toBe("critical");

      const elAll: ElementPhysicsSnapshot = {
        selector: "button.wipe-all",
        tagName: "BUTTON",
        text: "Wipe All Logs",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };
      const defAll = validateNormanRecovery(elAll, 2);
      expect(defAll).not.toBeNull();
      expect(defAll?.severity).toBe("critical");
    });
  });
});

import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const COMPOSITE_ROLES = new Set(["tablist", "menu", "menubar", "radiogroup", "grid", "tree"]);

export function validateWaiAriaFocusTrap(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const role = element.role?.toLowerCase();
  const tag = element.tagName.toUpperCase();

  const isModalDialog = role === "dialog" || role === "alertdialog" || tag === "DIALOG";

  if (isModalDialog) {
    const hasModalFlag = element.attributes?.["aria-modal"] === "true";
    const hasTrap = element.hasTrapFocus === true;

    if (!hasModalFlag && !hasTrap) {
      return {
        id: `cust-aria-trap-${index}`,
        pillar: "custom",
        category: "aria-focus-trap",
        elementSelector: element.selector,
        message: `Modal dialog (${element.selector}) missing WAI-ARIA 1.2 / Radix UI focus trap (aria-modal="true" and trapped keyboard cycling).`,
        severity: "critical",
        remediations: generateRemediations("aria-focus-trap"),
        metadata: {
          role: role ?? tag,
          hasTrapFocus: false,
          hasAriaModal: false,
        },
      };
    }
  }

  if (role && COMPOSITE_ROLES.has(role)) {
    const hasRoving = element.hasRovingTabindex === true;
    const hasActiveDescendant = Boolean(element.attributes?.["aria-activedescendant"]);

    if (!hasRoving && !hasActiveDescendant) {
      return {
        id: `cust-aria-roving-${index}`,
        pillar: "custom",
        category: "aria-focus-trap",
        elementSelector: element.selector,
        message: `Composite interactive widget with role="${role}" lacks roving tabindex or aria-activedescendant arrow key navigation.`,
        severity: "serious",
        remediations: generateRemediations("aria-focus-trap"),
        metadata: {
          role,
          hasRovingTabindex: false,
          hasActiveDescendant,
        },
      };
    }
  }

  return null;
}

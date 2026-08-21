import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const DESTRUCTIVE_KEYWORDS = ["delete", "remove", "destroy", "drop", "purge", "terminate", "wipe", "discard"];

function isDestructiveAction(element: ElementPhysicsSnapshot): boolean {
  if (element.isDestructive) return true;
  const text = element.text?.toLowerCase() ?? "";
  const selector = element.selector.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some((kw) => text.includes(kw) || selector.includes(kw));
}

export function validateNormanRecovery(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  if (!isDestructiveAction(element)) {
    return null;
  }

  const hasRecovery = element.hasUndo === true || element.hasConfirmation === true;

  if (!hasRecovery) {
    const isCritical = (element.text ?? "").toLowerCase().includes("account") || (element.text ?? "").toLowerCase().includes("all");
    return {
      id: `cog-norman-recovery-${index}`,
      pillar: "cognitive",
      category: "norman-grace",
      elementSelector: element.selector,
      message: `Destructive action "${element.text ?? element.selector}" lacks Don Norman error recovery mechanism (no undo grace period or confirmation dialog).`,
      severity: isCritical ? "critical" : "serious",
      remediations: generateRemediations("norman-grace"),
      metadata: {
        actionText: element.text ?? "",
        hasUndo: false,
        hasConfirmation: false,
      },
    };
  }

  return null;
}

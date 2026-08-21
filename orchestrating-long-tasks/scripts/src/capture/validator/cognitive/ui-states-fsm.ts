import type { ElementPhysicsSnapshot, UIInteractionState, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const REQUIRED_UI_STATES: readonly UIInteractionState[] = [
  "default",
  "hover",
  "active",
  "focus",
  "disabled",
];

export function validateUiStatesFsm(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const isInteractive =
    element.interactive ||
    element.tagName.toUpperCase() === "BUTTON" ||
    element.tagName.toUpperCase() === "A" ||
    element.tagName.toUpperCase() === "INPUT" ||
    element.tagName.toUpperCase() === "SELECT" ||
    element.role === "button" ||
    element.role === "link";

  if (!isInteractive || !element.implementedStates) {
    return null;
  }

  const implemented = new Set(element.implementedStates);
  const missingStates = REQUIRED_UI_STATES.filter((st) => {
    if (st === "disabled" && (implemented.has("disabled") || implemented.has("loading"))) {
      return false;
    }
    return !implemented.has(st);
  });

  if (missingStates.length > 0) {
    return {
      id: `cog-ui-states-fsm-${index}`,
      pillar: "cognitive",
      category: "ui-states-fsm",
      elementSelector: element.selector,
      message: `Interactive component is missing essential UI states: [${missingStates.join(", ")}]. Must implement complete 5-state FSM (default, hover, active, focus, disabled/loading).`,
      severity: "moderate",
      remediations: generateRemediations("ui-states-fsm"),
      metadata: {
        missingStates: missingStates.join(", "),
        implementedStates: element.implementedStates.join(", "),
      },
    };
  }

  return null;
}

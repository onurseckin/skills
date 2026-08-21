import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const MAX_UNSTRUCTURED_OPTIONS = 7;

export function calculateHickHymanEntropy(n: number): number {
  if (n <= 0) return 0;
  return Math.log2(n + 1);
}

export function validateHickHyman(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const children = element.children;
  if (!children || children.length === 0) return null;

  const role = element.role?.toLowerCase();
  const isChoiceContainer =
    role === "menu" ||
    role === "menubar" ||
    role === "listbox" ||
    role === "radiogroup" ||
    element.tagName.toUpperCase() === "SELECT" ||
    element.selector.includes("dropdown") ||
    element.selector.includes("actions-list");

  if (isChoiceContainer && children.length > MAX_UNSTRUCTURED_OPTIONS) {
    const entropy = calculateHickHymanEntropy(children.length);
    return {
      id: `cog-hick-hyman-${index}`,
      pillar: "cognitive",
      category: "hick-hyman",
      elementSelector: element.selector,
      message: `Choice container exposes ${children.length} unorganized options (entropy: ${entropy.toFixed(2)} bits), exceeding Hick-Hyman cognitive latency threshold (max ${MAX_UNSTRUCTURED_OPTIONS} items).`,
      severity: "moderate",
      remediations: generateRemediations("hick-hyman"),
      metadata: {
        optionCount: children.length,
        entropyBits: Number(entropy.toFixed(2)),
        maxRecommended: MAX_UNSTRUCTURED_OPTIONS,
      },
    };
  }

  return null;
}

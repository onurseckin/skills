import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

export function getExpectedAppleTracking(fontSize: number): { readonly min: number; readonly max: number; readonly expected: number } {
  if (fontSize <= 13) {
    return { min: -0.05, max: 0.4, expected: 0.1 };
  }
  if (fontSize <= 20) {
    return { min: -0.5, max: 0.2, expected: -0.2 };
  }
  if (fontSize <= 34) {
    return { min: -1.0, max: 0.0, expected: -0.5 };
  }
  return { min: -2.0, max: -0.2, expected: -1.0 };
}

export function validateAppleOpticalTracking(
  element: ElementPhysicsSnapshot,
  index: number
): ValidationDefect | null {
  const styles = element.computedStyles;
  if (!styles || styles.fontSize === undefined || styles.letterSpacing === undefined) {
    return null;
  }

  const fontFamily = (styles.fontFamily ?? "").toLowerCase();
  const isAppleFont =
    fontFamily.includes("sf pro") ||
    fontFamily.includes("apple-system") ||
    fontFamily.includes("blinkmacsystemfont") ||
    element.attributes?.["data-design-system"] === "apple-hig";

  if (!isAppleFont && !element.attributes?.["data-design-system"]) {
    return null;
  }

  const fontSize = styles.fontSize;
  const actualTracking = styles.letterSpacing;
  const spec = getExpectedAppleTracking(fontSize);

  if (actualTracking < spec.min || actualTracking > spec.max) {
    return {
      id: `cust-apple-tracking-${index}`,
      pillar: "custom",
      category: "apple-hig-tracking",
      elementSelector: element.selector,
      message: `Apple HIG optical tracking mismatch for fontSize=${fontSize}px: letterSpacing is ${actualTracking}px (expected ${spec.min}px to ${spec.max}px).`,
      severity: "minor",
      remediations: generateRemediations("apple-hig-tracking"),
      metadata: {
        fontSize,
        actualTracking,
        expectedMin: spec.min,
        expectedMax: spec.max,
      },
    };
  }

  return null;
}

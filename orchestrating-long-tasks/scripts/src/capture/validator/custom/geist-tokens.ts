import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const GEIST_ALLOWED_RADII = new Set([0, 4, 6, 8, 12, 16, 24, 9999]);

export function validateGeistTokens(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const styles = element.computedStyles;
  if (!styles) return null;

  const isGeistContext =
    element.attributes?.["data-design-system"] === "geist" ||
    (styles.fontFamily && styles.fontFamily.toLowerCase().includes("geist")) ||
    element.selector.includes("geist");

  if (!isGeistContext && !element.attributes?.["data-design-system"]) {
    return null;
  }

  const radius = styles.borderRadius;
  if (radius !== undefined && radius > 0 && !GEIST_ALLOWED_RADII.has(radius)) {
    return {
      id: `cust-geist-tokens-${index}`,
      pillar: "custom",
      category: "geist-tokens",
      elementSelector: element.selector,
      message: `Border radius ${radius}px violates Vercel Geist token scale (allowed: [0, 4, 6, 8, 12, 16, 24, 9999]px).`,
      severity: "minor",
      remediations: generateRemediations("geist-tokens"),
      metadata: {
        actualRadius: radius,
        allowedRadii: Array.from(GEIST_ALLOWED_RADII).join(", "),
      },
    };
  }

  return null;
}

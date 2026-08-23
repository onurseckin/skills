import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

export function validateConcentricRadius(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const childRadius = element.computedStyles?.borderRadius;
  const parentRadius = element.parentBorderRadius;
  const parentPadding = element.parentPadding;

  if (
    childRadius !== undefined &&
    parentRadius !== undefined &&
    parentPadding !== undefined &&
    childRadius > 0 &&
    parentRadius > 0 &&
    parentPadding > 0
  ) {
    const expectedOuterRadius = childRadius + parentPadding;
    const diff = Math.abs(parentRadius - expectedOuterRadius);

    if (diff > 2) {
      return {
        id: `mech-concentric-radius-${index}`,
        pillar: "mechanical",
        category: "concentric-radius",
        elementSelector: element.selector,
        message: `Concentric corner radius mismatch: outer radius is ${parentRadius}px but expected ${expectedOuterRadius}px (inner radius ${childRadius}px + padding ${parentPadding}px).`,
        severity: "moderate",
        remediations: generateRemediations("concentric-radius"),
        metadata: {
          innerRadius: childRadius,
          parentPadding,
          actualOuterRadius: parentRadius,
          expectedOuterRadius,
        },
      };
    }
  }

  // Also check if element has children with defined radius & padding
  if (
    element.children &&
    element.children.length > 0 &&
    element.computedStyles?.borderRadius &&
    element.computedStyles.padding
  ) {
    const outerRadius = element.computedStyles.borderRadius;
    const padding = element.computedStyles.padding;

    for (let cIdx = 0; cIdx < element.children.length; cIdx++) {
      const child = element.children[cIdx];
      if (!child) continue;
      const innerRadius = child.computedStyles?.borderRadius;

      if (innerRadius !== undefined && innerRadius > 0 && outerRadius > 0 && padding > 0) {
        const expectedOuter = innerRadius + padding;
        const diff = Math.abs(outerRadius - expectedOuter);

        if (diff > 2) {
          return {
            id: `mech-concentric-radius-child-${index}-${cIdx}`,
            pillar: "mechanical",
            category: "concentric-radius",
            elementSelector: `${element.selector} > ${child.selector}`,
            message: `Concentric corner radius mismatch: container radius is ${outerRadius}px but expected ${expectedOuter}px for child radius ${innerRadius}px with ${padding}px padding.`,
            severity: "moderate",
            remediations: generateRemediations("concentric-radius"),
            metadata: {
              innerRadius,
              padding,
              actualOuterRadius: outerRadius,
              expectedOuterRadius: expectedOuter,
            },
          };
        }
      }
    }
  }

  return null;
}

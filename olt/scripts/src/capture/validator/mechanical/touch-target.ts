import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const MIN_TOUCH_DIMENSION = 44;
const MIN_CIRCULAR_CLEARANCE = 24;

export function validateTouchTargetDimensions(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const isInteractive =
    element.interactive || element.isTouchTarget || isInteractiveTag(element.tagName);
  if (!isInteractive) return null;

  const { width, height } = element.bounds;
  if (width === 0 || height === 0) return null;

  if (width < MIN_TOUCH_DIMENSION || height < MIN_TOUCH_DIMENSION) {
    const severity = width < 24 || height < 24 ? "critical" : "serious";
    return {
      id: `mech-touch-dim-${index}`,
      pillar: "mechanical",
      category: "touch-target",
      elementSelector: element.selector,
      message: `Touch target size (${Math.round(width)}x${Math.round(height)}px) violates minimum ${MIN_TOUCH_DIMENSION}x${MIN_TOUCH_DIMENSION}px accessibility standard.`,
      severity,
      remediations: generateRemediations("touch-target"),
      metadata: {
        width: Math.round(width),
        height: Math.round(height),
        minRequired: MIN_TOUCH_DIMENSION,
      },
    };
  }

  return null;
}

export function validateTouchTargetClearance(
  targets: readonly ElementPhysicsSnapshot[],
): readonly ValidationDefect[] {
  const defects: ValidationDefect[] = [];
  const interactiveTargets = targets.filter(
    (el) =>
      el &&
      (el.interactive || el.isTouchTarget || isInteractiveTag(el.tagName)) &&
      el.bounds.width > 0 &&
      el.bounds.height > 0,
  );

  for (let i = 0; i < interactiveTargets.length; i++) {
    const a = interactiveTargets[i];
    if (!a) continue;

    const centerA = {
      x: a.bounds.x + a.bounds.width / 2,
      y: a.bounds.y + a.bounds.height / 2,
    };

    for (let j = i + 1; j < interactiveTargets.length; j++) {
      const b = interactiveTargets[j];
      if (!b) continue;

      const centerB = {
        x: b.bounds.x + b.bounds.width / 2,
        y: b.bounds.y + b.bounds.height / 2,
      };

      const dist = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
      const minCenterDist = (a.bounds.width + b.bounds.width) / 4 + MIN_CIRCULAR_CLEARANCE;

      // Check if bounding boxes overlap or are too close
      const horizontalOverlap = Math.max(
        0,
        Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) -
          Math.max(a.bounds.x, b.bounds.x),
      );
      const verticalOverlap = Math.max(
        0,
        Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) -
          Math.max(a.bounds.y, b.bounds.y),
      );

      const edgeDistance =
        dist -
        (Math.min(a.bounds.width, a.bounds.height) + Math.min(b.bounds.width, b.bounds.height)) / 2;

      if (
        (dist < minCenterDist && horizontalOverlap > 0 && verticalOverlap > 0) ||
        (edgeDistance < MIN_CIRCULAR_CLEARANCE && edgeDistance >= 0 && dist < 48)
      ) {
        defects.push({
          id: `mech-touch-clearance-${i}-${j}`,
          pillar: "mechanical",
          category: "touch-target",
          elementSelector: `${a.selector} <-> ${b.selector}`,
          message: `Touch targets have insufficient circular clearance (${Math.round(dist)}px center distance, minimum ${MIN_CIRCULAR_CLEARANCE}px perimeter clearance).`,
          severity: "serious",
          remediations: generateRemediations("touch-target"),
          metadata: {
            centerDistance: Math.round(dist),
            targetA: a.selector,
            targetB: b.selector,
          },
        });
      }
    }
  }

  return defects;
}

function isInteractiveTag(tagName: string): boolean {
  const upper = tagName.toUpperCase();
  return (
    upper === "BUTTON" ||
    upper === "A" ||
    upper === "INPUT" ||
    upper === "SELECT" ||
    upper === "TEXTAREA"
  );
}

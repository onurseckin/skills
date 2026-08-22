import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

const MAX_INDEX_OF_DIFFICULTY = 5.5;

export function calculateFittsId(
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  originX: number,
  originY: number,
): number {
  const centerX = targetX + targetWidth / 2;
  const centerY = targetY + targetHeight / 2;
  const distance = Math.hypot(centerX - originX, centerY - originY);
  if (distance <= 0) return 0;
  const effectiveWidth = Math.max(1, Math.min(targetWidth, targetHeight));
  if (effectiveWidth <= 0) return 0;

  // Fitts's Law Index of Difficulty: ID = log2(2D / W)
  const ratio = (2 * distance) / effectiveWidth;
  return ratio <= 1 ? 0 : Math.log2(ratio);
}

export function validateFittsLaw(
  element: ElementPhysicsSnapshot,
  index: number,
  viewportBounds?: { readonly width: number; readonly height: number },
): ValidationDefect | null {
  const isButton =
    element.tagName.toUpperCase() === "BUTTON" || element.role === "button" || element.interactive;
  if (!isButton) return null;

  const vpW = viewportBounds?.width ?? 1280;
  const vpH = viewportBounds?.height ?? 800;
  const originX = vpW / 2;
  const originY = vpH / 2;

  const id = calculateFittsId(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    originX,
    originY,
  );

  if (id > MAX_INDEX_OF_DIFFICULTY) {
    return {
      id: `cog-fitts-${index}`,
      pillar: "cognitive",
      category: "fitts-law",
      elementSelector: element.selector,
      message: `Target Index of Difficulty (${id.toFixed(2)} bits) exceeds ergonomic threshold (${MAX_INDEX_OF_DIFFICULTY} bits), increasing motor selection error.`,
      severity: "moderate",
      remediations: generateRemediations("fitts-law"),
      metadata: {
        indexOfDifficultyBits: Number(id.toFixed(2)),
        maxAllowed: MAX_INDEX_OF_DIFFICULTY,
      },
    };
  }

  return null;
}

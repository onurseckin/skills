import { MIN_TOUCH_HITBOX_PT } from "./constants.ts";
import type { TouchTargetInspection } from "./types.ts";

export function inspectTouchHitbox(
  selector: string,
  width: number,
  height: number,
  minDimension: number = MIN_TOUCH_HITBOX_PT,
): TouchTargetInspection {
  const passed = width >= minDimension && height >= minDimension;
  const message = passed
    ? `Touch target ${selector} satisfies ${width}x${height}pt hitbox (>= ${minDimension}pt floor)`
    : `Touch target ${selector} (${Math.round(width)}x${Math.round(height)}pt) violates minimum ${minDimension}x${minDimension}pt accessibility hitbox floor`;

  return {
    selector,
    width,
    height,
    passed,
    minRequired: minDimension,
    message,
  };
}

export function inspectAllTouchHitboxes(
  targets: readonly {
    selector: string;
    width: number;
    height: number;
    isInteractive?: boolean | undefined;
  }[],
  minDimension: number = MIN_TOUCH_HITBOX_PT,
): {
  evaluations: readonly TouchTargetInspection[];
  failures: readonly TouchTargetInspection[];
} {
  const evaluations: TouchTargetInspection[] = [];
  const failures: TouchTargetInspection[] = [];

  for (const target of targets) {
    if (target.isInteractive === false) continue;
    const result = inspectTouchHitbox(target.selector, target.width, target.height, minDimension);
    evaluations.push(result);
    if (!result.passed) {
      failures.push(result);
    }
  }

  return { evaluations, failures };
}

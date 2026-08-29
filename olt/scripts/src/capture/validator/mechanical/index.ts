import type { PillarValidationResult, ValidationContext, ValidationDefect } from "../types.ts";
import { validateApcaElement, calculateApcaLightness } from "./apca.ts";
import { validateTouchTargetDimensions, validateTouchTargetClearance } from "./touch-target.ts";
import { validateConcentricRadius } from "./concentric-radius.ts";
import { validateSubpixelSnapping } from "./subpixel-snapping.ts";
import { validateClsReservation } from "./cls-reservation.ts";
import { validateSidebarLayout } from "./sidebar-layout.ts";

export { calculateApcaLightness, validateApcaElement } from "./apca.ts";

export { validateTouchTargetDimensions, validateTouchTargetClearance } from "./touch-target.ts";

export { validateConcentricRadius } from "./concentric-radius.ts";

export { validateSubpixelSnapping } from "./subpixel-snapping.ts";

export { validateClsReservation } from "./cls-reservation.ts";

export { validateSidebarLayout } from "./sidebar-layout.ts";

export {
  NAMED_COLORS,
  auditFocusRingContrast,
  calculateConcentricRadius,
  calculateOpticalCurvatureMetrics,
  calculateWcagLuminance,
  compositeColorOver,
  getSubpixelFraction,
  hslToRgb,
  parseCssColor,
  snapToDevicePixelRatio,
  srgbChannelToLinear,
  validateFocusRingOpticalSnapping,
  validateNestedConcentricCorners,
  type ConcentricCornerEvaluation,
  type DprSnapEvaluation,
  type FocusRingDefect,
  type FocusRingDefectType,
  type FocusRingGeometry,
  type OpticalCurvatureMetrics,
  type OpticalSnapResult,
  type OpticalSnappingOptions,
  type RgbaColor,
} from "./focus-ring-optical/index.ts";

export function validateMechanical(ctx: ValidationContext): PillarValidationResult {
  const defects: ValidationDefect[] = [];
  const elements = ctx.elements;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;

    // 1. APCA Contrast
    const apcaDefect = validateApcaElement(el, i);
    if (apcaDefect) defects.push(apcaDefect);

    // 2. Touch Target Dimensions
    const touchDimDefect = validateTouchTargetDimensions(el, i);
    if (touchDimDefect) defects.push(touchDimDefect);

    // 3. Concentric Radii
    const radiusDefect = validateConcentricRadius(el, i);
    if (radiusDefect) defects.push(radiusDefect);

    // 4. Subpixel Snapping
    const subpixelDefect = validateSubpixelSnapping(el, i);
    if (subpixelDefect) defects.push(subpixelDefect);

    // 5. CLS Reservation
    const clsDefect = validateClsReservation(el, i);
    if (clsDefect) defects.push(clsDefect);
  }

  // 6. Touch Target Clearance across elements
  const clearanceDefects = validateTouchTargetClearance(elements);
  defects.push(...clearanceDefects);

  // 7. Sidebar Layout
  const sidebarDefects = validateSidebarLayout(elements, ctx.sidebarConfig, ctx.viewportBounds);
  defects.push(...sidebarDefects);

  return {
    pillar: "mechanical",
    passed: defects.length === 0,
    defects,
    evaluatedCount: elements.length,
  };
}

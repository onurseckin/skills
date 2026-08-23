import type { PillarValidationResult, ValidationContext, ValidationDefect } from "../types.ts";
import { validateWaiAriaFocusTrap } from "./wai-aria-focus-trap.ts";
import { validateFloatingUiCollision } from "./floating-ui-collision.ts";
import { validateMaterialStateLayers } from "./material-state-layers.ts";
import { validateAppleOpticalTracking } from "./apple-optical-tracking.ts";
import { validateGeistTokens } from "./geist-tokens.ts";

export * from "./wai-aria-focus-trap.ts";
export * from "./floating-ui-collision.ts";
export * from "./material-state-layers.ts";
export * from "./apple-optical-tracking.ts";
export * from "./geist-tokens.ts";

export function validateCustom(ctx: ValidationContext): PillarValidationResult {
  const defects: ValidationDefect[] = [];
  const elements = ctx.elements;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;

    // 1. WAI-ARIA 1.2 / Radix Focus Traps & Roving Tabindex
    const ariaDefect = validateWaiAriaFocusTrap(el, i);
    if (ariaDefect) defects.push(ariaDefect);

    // 2. Floating UI Collision Detection
    const floatingDefect = validateFloatingUiCollision(el, i, ctx.viewportBounds);
    if (floatingDefect) defects.push(floatingDefect);

    // 3. Material Design 3 State Layers
    const md3Defect = validateMaterialStateLayers(el, i);
    if (md3Defect) defects.push(md3Defect);

    // 4. Apple HIG Optical Tracking Curves
    const appleDefect = validateAppleOpticalTracking(el, i);
    if (appleDefect) defects.push(appleDefect);

    // 5. Vercel Geist Tokens
    const geistDefect = validateGeistTokens(el, i);
    if (geistDefect) defects.push(geistDefect);
  }

  return {
    pillar: "custom",
    passed: defects.length === 0,
    defects,
    evaluatedCount: elements.length,
  };
}

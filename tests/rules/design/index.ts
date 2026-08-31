/**
 * Rules Design Subdomain Test Facade.
 * Explicit named exports for design system, floating UI, and typography rules.
 */

export {
  getExpectedAppleTracking,
  validateAppleOpticalTracking,
} from "../../../olt/scripts/src/capture/validator/custom/apple-optical-tracking.ts";

export { validateFloatingUiCollision } from "../../../olt/scripts/src/capture/validator/custom/floating-ui-collision.ts";
export { validateGeistTokens } from "../../../olt/scripts/src/capture/validator/custom/geist-tokens.ts";
export { validateMaterialStateLayers } from "../../../olt/scripts/src/capture/validator/custom/material-state-layers.ts";
export { validateWaiAriaFocusTrap } from "../../../olt/scripts/src/capture/validator/custom/wai-aria-focus-trap.ts";
export { validateCustom } from "../../../olt/scripts/src/capture/validator/custom/index.ts";

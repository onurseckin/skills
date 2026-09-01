export type {
  OpticalQuarantineInvariant,
  QuarantineCategory,
  ToolDescriptor,
  ToolInvocationContext,
  QuarantineCheckResult,
  BackdoorDetectionResult,
  QuarantineEnforcementResult,
  QuarantineAuditRecord,
} from "./types.ts";

export {
  OPTICAL_QUARANTINE_INVARIANTS,
} from "./types.ts";

export {
  PERMITTED_IMAGE_EXTENSIONS,
  FORBIDDEN_SOURCE_EXTENSIONS,
  AUTHORIZED_BROWSER_TOOLS,
  AUTHORIZED_VISUAL_TOOLS,
  AUTHORIZED_MESSAGING_TOOLS,
  FORBIDDEN_TOOLS,
} from "./constants.ts";

export {
  EVALUATE_SCRIPT_HOST_FS_PATTERNS,
  SHELL_INJECTION_PATTERNS,
  LOCAL_URL_BYPASS_PATTERNS,
} from "./patterns.ts";

export {
  isOpticalValidatorRole,
  verifyCapability,
  detectBackdoorBypass,
} from "./inspectors.ts";

export {
  ToolQuarantineEngine,
  getDefaultQuarantineEngine,
  setDefaultQuarantineEngine,
  resetDefaultQuarantineEngine,
} from "./engine.ts";

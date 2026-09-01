// @ts-nocheck
export type {
  GpuAcceleratedProperty,
  LayoutTriggeringProperty,
  SpringPresetConfig,
  SpringPresetKey,
  SpringPresetName,
  FrameSample,
  LayoutShiftSample,
  AnimatedPropertyAudit,
  MotionHeadlessPreFlightInput,
  MotionHeadlessPreFlightResult,
  KeyframeSamplePoint,
  TemporalKeyframeInspectionInput,
  TemporalKeyframeInspectionResult,
  FocusRingMetrics,
  FocusRingInspectionResult,
  HoverLiftMetrics,
  HoverLiftInspectionResult,
  TrajectoryPoint,
  SpringPhysicsInspectionInput,
  SpringPhysicsInspectionResult,
} from "./types.ts";

export {
  TARGET_FRAME_RATE,
  TARGET_FRAME_DURATION_MS,
  JANK_FRAME_THRESHOLD_MS,
  MAX_PERMISSIBLE_JANK_RATE,
  MAX_PERMISSIBLE_CLS,
  GPU_ACCELERATED_PROPERTIES,
  LAYOUT_TRIGGERING_PROPERTIES,
  SPRING_PRESETS,
} from "./types.ts";

export { HeadlessMotionPreFlightAuditor } from "./preflight-auditor.ts";
export { TemporalKeyframeStepSampler } from "./sampler.ts";
export { MicrocraftInspector } from "./microcraft.ts";
export {
  MotionVerificationEngine,
  getDefaultMotionVerificationEngine,
  setDefaultMotionVerificationEngine,
  resetDefaultMotionVerificationEngine,
} from "./engine.ts";

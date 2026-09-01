// @ts-nocheck
export type {
  CompositeArtifactKey,
  EvidenceTier,
  ArtifactMetadata,
  OpticalStabilityInput,
  OpticalStabilityResult,
  EvidenceStorageStats,
  PixelDeltaSeverity,
  PixelCoordinate,
  BoundingBox,
  VisualDeltaInput,
  VisualDeltaReport,
} from "./types.ts";

export { CompositeKeyParser } from "./composite-key-parser.ts";
export { OpticalStabilityBarrier } from "./stability-barrier.ts";
export { LifecycleManager } from "./lifecycle-manager.ts";
export { VisualDeltaComparator } from "./visual-delta.ts";
export {
  EvidenceLifecycleEngine,
  getDefaultEvidenceLifecycleEngine,
  setDefaultEvidenceLifecycleEngine,
  resetDefaultEvidenceLifecycleEngine,
} from "./engine.ts";

export {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  resolveDefectsJsonlPath,
  cleanupVestigialDefectsFile,
} from "./lifecycle-sync.ts";
export type { DoctorFindingInput } from "./lifecycle-sync.ts";

export {
  LIFECYCLE_PHASES,
  validatePhaseTransition,
  enforceSequentialLifecycleOrdering,
  VALID_DEFECT_STATE_TRANSITIONS,
  validateDefectStateTransition,
  transitionDefectState,
} from "./order-enforcement.ts";

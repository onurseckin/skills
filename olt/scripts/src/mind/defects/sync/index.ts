export {
  syncDoctorFindingsToDefects,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  resolveDefectsJsonlPath,
} from "./lifecycle-sync.ts";
export type { DoctorFindingInput } from "./lifecycle-sync.ts";

export {
  LIFECYCLE_PHASES,
  validatePhaseTransition,
  enforceSequentialLifecycleOrdering,
} from "./order-enforcement.ts";

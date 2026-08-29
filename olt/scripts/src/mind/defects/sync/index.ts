export {
  syncDoctorFindingsToDefects,
  normalizeFindingToDefect,
  parseDefectsJsonl,
  serializeDefectsJsonl,
  resolveDefectsJsonlPath,
  cleanupVestigialDefectsFile,
} from "./lifecycle-sync.ts";
export type { DoctorFindingInput } from "./lifecycle-sync.ts";

export { computeNormalizedFailureSignature, type FailureSignatureInput } from "./signature.ts";

export {
  verifyFailureProof,
  assertFailureProofValid,
  type ProofVerificationResult,
  type EmpiricalFailureProof,
} from "./proof-verifier.ts";

export {
  VALID_DEFECT_STATE_TRANSITIONS,
  validateDefectStateTransition,
  transitionDefectState,
  handleDefectRecurrence,
  type DefectLifecycleStatus,
} from "./state-machine.ts";

export {
  LIFECYCLE_PHASES,
  validatePhaseTransition,
  enforceSequentialLifecycleOrdering,
} from "./order-enforcement.ts";

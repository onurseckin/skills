// @ts-nocheck
export type {
  MilestoneLockStatus,
  UnlockRecord,
  ImmutabilityManifest,
  SealMilestoneInput,
  EmpiricalRegressionProof,
  OpticalRegressionUnlockToken,
  ManifestIntegrityResult,
  LockSystemIntegrityReport,
  ScopeMutationRequest,
} from "./types.ts";

export {
  ROUND_SCOPES,
  DEFAULT_UNLOCK_TOKEN_EXPIRATION_MS,
  MIN_ROOT_CAUSE_ANALYSIS_LENGTH,
} from "./types.ts";

export {
  canonicalJsonStringify,
  computeSha256,
  computeManifestSignature,
} from "./hashing.ts";

export {
  requestOpticalRegressionUnlock,
  verifyRegressionProof,
  resealMilestone,
} from "./exception-protocol.ts";

export {
  verifyManifestIntegrity,
  verifyAllMilestoneLocks,
  assertIntegrity,
} from "./verifier.ts";

export {
  MilestoneLockEngine,
  getDefaultMilestoneLockEngine,
  setDefaultMilestoneLockEngine,
  resetDefaultMilestoneLockEngine,
} from "./engine.ts";

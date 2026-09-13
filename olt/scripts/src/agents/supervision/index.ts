export type {
  AdoptionConfinementParams,
  AgentSupervisionTier,
  ConfinementValidationFailure,
  ConfinementValidationResult,
  ConfinementValidationSuccess,
  RegistrationConfinementParams,
  SupervisoryBoundaryCheckParams,
  Tier0AuditorRole,
} from "./types.ts";

export {
  assertAdoptionConfinement,
  assertRegistrationConfinement,
  assertStrictNullParent,
  assertSubordinateMustBeParented,
  assertTier0CannotParentSubordinates,
  isSubordinateRole,
  safeFormatValue,
  validateAdoptionConfinement,
  validateRegistrationConfinement,
} from "./tier0-confinement.ts";

export {
  assertNoSupervisoryAdoptionOfTier0,
  assertNoSupervisoryRegistrationOfTier0,
  isSupervisoryTierRole,
  isTier0Auditor,
  isTier0AuditorAgentId,
  isTier0AuditorRole,
  resolveAgentTier,
  verifySupervisoryRoleBoundary,
} from "./role-boundary-verifier.ts";

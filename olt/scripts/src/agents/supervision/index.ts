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
  isTier0Auditor,
  isTier0AuditorAgentId,
  isTier0AuditorRole,
  safeFormatValue,
  validateAdoptionConfinement,
  validateRegistrationConfinement,
} from "./tier0-confinement.ts";

export {
  assertNoSupervisoryAdoptionOfTier0,
  assertNoSupervisoryRegistrationOfTier0,
  isSupervisoryTierRole,
  resolveAgentTier,
  verifySupervisoryRoleBoundary,
} from "./role-boundary-verifier.ts";

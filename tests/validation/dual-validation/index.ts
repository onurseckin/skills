/**
 * Dual-Validation Facade.
 */
export {
  evaluateDualUiGates,
  validateUiCognitive,
  validateUiMechanic,
  CANONICAL_4_VIEWPORTS,
  ALL_4_VIEWPORT_TIERS,
} from "./ui/index.ts";

export {
  assertCognitiveValidatorHardlock,
  assertValidatorRoleConfinement,
  loadValidatorDomainContract,
  type ValidatorDomain,
} from "./roles/index.ts";

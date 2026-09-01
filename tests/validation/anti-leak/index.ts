/**
 * Anti-Leak Facade.
 */
export {
  assertAcyclicPushbackDelegation,
  assertNoBoundaryLeak,
  delegateRepairTask,
  detectGraphCycles,
  isBoundaryLeakViolation,
  isCodeMutationAction,
  isCriticOrValidatorAgent,
  isCriticOrValidatorRole,
  isSupervisorRole,
  validateAcyclicPushbackDelegation,
  validateBoundaryIntegrity,
  type BoundaryLeakCheck,
  type BoundaryViolation,
  type RepairDelegationOrder,
  type AntiLeakValidationResult,
} from "../../../olt/scripts/src/validation/anti-leak/index.ts";

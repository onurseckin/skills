export { assignReplacementRepairer, type ReplacementReason } from "./assign-repairer.ts";

export { beginValidation } from "./begin-validation.ts";

export { assertValidatorCommands } from "./command-evidence.ts";

export {
  recordCoordinatorPushback,
  validateCoordinatorPushbackInput,
  type CoordinatorPushbackInput,
} from "./coordinator-pushback.ts";

export {
  FINDING_CLASSES,
  findingClassOf,
  isFindingClass,
  isProbeDemand,
  type FindingClass,
} from "./finding-class.ts";

export {
  findingFalsifiabilityVerdict,
  type FindingFalsifiabilityVerdict,
} from "./finding-falsifiability.ts";

export {
  DEFAULT_MAX_MICRO_CYCLES,
  DEFAULT_REPAIR_LEASE_SECONDS,
  formatMicroCycleFeedback,
  getLatestMicroCycle,
  getOpenMicroCycles,
  markMicroCycleAddressed,
  recordMicroCycleCritique,
  type MicroCycleCritiqueResult,
  type RecordMicroCycleOptions,
} from "./micro-cycle.ts";

export {
  assertGateProofFalsifiable,
  assertGatesNotFailing,
  assertProbeSatisfied,
  claimedBaseSha,
  failingGateRuns,
  gateFalsifiabilityStatuses,
  gateRunEvidence,
  probeRoundsRecorded,
  type FailingGateRun,
  type GateFalsifiabilityStatus,
  type GateRunEvidence,
} from "./pass-preconditions.ts";

export { recordProbe, validateProbe, type ProbeInput } from "./record-probe.ts";

export { recordReview, recordReview as recordReviewVerdict } from "./record-review.ts";

export {
  readReviewShape,
  reviewRecordedPayload,
  type ReviewRecordedPayload,
  type ReviewShape,
  type ThinReviewRecordedPayload,
} from "./review-event.ts";

export {
  assertRoleArtifactPresent,
  classifiesAsUiTask,
  gateReviewPayload,
  pruneNonUiPayload,
  taskClassificationTexts,
  type RoleArtifactEvidence,
} from "./role-evidence.ts";

export {
  validateChecklistCoverage,
  validateFindings,
  validateReview,
  type AdjacentFinding,
  type ChecklistCoverageEntry,
  type ChecklistCoverageReport,
  type ChecklistDisposition,
  type FindingClassRule,
  type ReviewInput,
  type RevalidationProof,
} from "./validate-review.ts";

export {
  archiveOpenValidations,
  archiveValidationForDomain,
  archiveValidationForValidator,
  earliestOpenValidation,
  everyApplicableDomainPassed,
  openValidations,
  validationForDomain,
  validationForValidator,
} from "./validation-state.ts";

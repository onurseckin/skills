export {
  completionArtifactRequirements,
  validateCompletionArtifactVerification,
  type CompletionArtifactRequirements,
} from "./artifact-verification.ts";

export {
  executeAutoSyncAndCommit,
  type AutoSyncOptions,
  type AutoSyncResult,
  type GitRunner,
  type GitRunnerResult,
  type SyncRunner,
  type SyncRunnerResult,
} from "./auto-sync-and-commit.ts";

export { beginCompletenessCritic, type BeginCriticOptions } from "./begin-completeness-critic.ts";

export { completeRun, type CompletionArtifactVerifier } from "./complete-run.ts";

export { completionHistoryIssues } from "./completion-history.ts";

export { completionReviewDigest, jsonDigest } from "./completion-review-digest.ts";

export {
  completionIssues,
  gateTally,
  mandatoryRunGateCommands,
  type GateTally,
} from "./completion-state.ts";

export {
  generateStructuredFindingsFromCritic,
  isDeterministicFindingRepeat,
  routeCriticReviewFindings,
  trackTaskRepairBudget,
  type RouteCriticFindingsOptions,
  type RouteCriticFindingsResult,
  type TaskRepairBudgetStatus,
  type TaskRepairSummary,
} from "./critic-feedback-loop.ts";

export { assertCriticIndependent } from "./critic-identity.ts";

export { observeCapsuleIntegrity, type CapsuleIntegrityEvidence } from "./integrity-evidence.ts";

export { parseRawFindings } from "./parse-raw-findings.ts";

export { parseRawProofs } from "./parse-raw-proofs.ts";

export { completionReadinessIssues } from "./readiness-issues.ts";

export {
  commandIsSuccessfulGate,
  completionReadinessSnapshot,
  type CompletionReadinessSnapshot,
} from "./readiness-snapshot.ts";

export { recordCompletionRemediation } from "./record-completion-remediation.ts";

export { recordCompletionReview } from "./record-completion-review.ts";

export {
  currentRepositoryBinding,
  repositoryBindingIsValid,
  sameRepositoryBinding,
  validateRepositoryBinding,
  verifyRepositoryBinding,
  type RepositoryBindingVerifier,
} from "./repository-binding.ts";

export { authoritativeRepositoryCommand } from "./repository-evidence.ts";

export { parseCompletionAssessment } from "./review-input.ts";

export { completionReviewIssues } from "./review-issues.ts";

export { transitionSummaryIssues } from "./transition-summary-issues.ts";

export {
  type CompletionArtifactPacket,
  type CompletionArtifactVerification,
  type CompletionCriticAuthorization,
  type CompletionEvidenceItem,
  type CompletionFinding,
  type CompletionFindingResolution,
  type CompletionRemediation,
  type CompletionRequirementProof,
  type CompletionResidualRisk,
  type CompletionResult,
  type CompletionReview,
} from "./types.ts";

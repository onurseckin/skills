import { checkPlanningDag, type PlanningDagCheckOptions } from "./planning-dag-engine.ts";
import {
  checkAstPurity,
  scanFileForAstPurity,
  type AstPurityCheckOptions,
} from "./ast-purity-engine.ts";
import {
  checkAntiMockMutation,
  type AntiMockMutationCheckOptions,
  type CounterfactualCheckRecord,
} from "./anti-mock-engine.ts";
import {
  checkAntiBatchingIsolation,
  type AntiBatchingIsolationOptions,
} from "./anti-batching-engine.ts";
import { checkDualChannelUi, type DualChannelUiCheckOptions } from "./dual-channel-ui-engine.ts";
import {
  checkCognitiveValidatorCommandLock,
  checkCommandLockIntegrity,
  type CognitiveValidatorCommandLockOptions,
} from "./command-lock-engine.ts";
import {
  checkRoleBoundaryInterlock,
  type RoleBoundaryInterlockOptions,
} from "./role-boundary-engine.ts";
import {
  checkPushbackQuotas,
  type PushbackQuotasCheckOptions,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "./pushback-quotas-engine.ts";
import {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
  type RepositoryHygieneOptions,
} from "./hygiene-engine.ts";
import {
  checkGitIndexIntegrity,
  autoHealGitState,
  type GitIndexCheckOptions,
  type AutoHealGitStateOptions,
} from "./git-index-engine.ts";
import {
  cleanseDanglingLocks,
  isProcessAlive,
  recoverStaleLeases,
  type LockCleanerOptions,
} from "./lock-cleaner.ts";
import { checkPolicyDoctor, auditPolicyDoctor, type PolicyDoctorOptions } from "./policy-doctor.ts";
import { autoHealCapsule, quarantineTornTail, type AutoHealOptions } from "./auto-heal.ts";
import {
  checkMailboxHealth,
  checkMailboxDiskActivity,
  autoHealMailboxState,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
  type MailboxHealthOptions,
  type DoctorCheckResult,
} from "./mailbox-health-engine.ts";
import {
  checkWorktreeHealth,
  autoHealWorktreeState,
  type DoctorWorktreeHealthReport,
  type WorktreeHealthOptions,
} from "./worktree-health-engine.ts";
import {
  checkEpistemicConfidence,
  type EpistemicConfidenceCheckOptions,
} from "./epistemic-engine.ts";
import {
  checkCliRegistryTaxonomy,
  type CliRegistryTaxonomyCheckOptions,
} from "./registry-engine.ts";
import {
  checkPreCompletionDiagnostics,
  type PreCompletionDiagnosticsOptions,
  type PreCompletionDiagnosticsResult,
  type PreCompletionBlocker,
} from "./pre-completion.ts";
import { checkQuotaHealth, type QuotaHealthCheckOptions } from "./quota-health-engine.ts";
import {
  checkTier0CompanionsHealth,
  type Tier0CompanionsCheckOptions,
} from "./tier0-companions-engine.ts";
import {
  generateRemedialGuidance,
  remedialActionsForIntegrityIssues,
  type DoctorRemedialAction,
  type GuidanceGenerationOptions,
  type DoctorGuidanceResult,
} from "./guidance.ts";

export {
  checkPlanningDag,
  checkAstPurity,
  scanFileForAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkCommandLockIntegrity,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  checkQuotaHealth,
  checkRepositoryHygiene,
  purgeOrphanedScratch,
  checkGitIndexIntegrity,
  autoHealGitState,
  cleanseDanglingLocks,
  isProcessAlive,
  recoverStaleLeases,
  checkPolicyDoctor,
  auditPolicyDoctor,
  autoHealCapsule,
  quarantineTornTail,
  checkMailboxHealth,
  checkMailboxDiskActivity,
  autoHealMailboxState,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
  checkWorktreeHealth,
  autoHealWorktreeState,
  checkEpistemicConfidence,
  checkCliRegistryTaxonomy,
  checkTier0CompanionsHealth,
  checkPreCompletionDiagnostics,
  generateRemedialGuidance,
  remedialActionsForIntegrityIssues,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
};

export type {
  PlanningDagCheckOptions,
  AstPurityCheckOptions,
  AntiMockMutationCheckOptions,
  CounterfactualCheckRecord,
  AntiBatchingIsolationOptions,
  DualChannelUiCheckOptions,
  CognitiveValidatorCommandLockOptions,
  RoleBoundaryInterlockOptions,
  PushbackQuotasCheckOptions,
  QuotaHealthCheckOptions,
  RepositoryHygieneOptions,
  GitIndexCheckOptions,
  AutoHealGitStateOptions,
  LockCleanerOptions,
  PolicyDoctorOptions,
  AutoHealOptions,
  MailboxHealthOptions,
  DoctorWorktreeHealthReport,
  WorktreeHealthOptions,
  EpistemicConfidenceCheckOptions,
  CliRegistryTaxonomyCheckOptions,
  Tier0CompanionsCheckOptions,
  PreCompletionDiagnosticsOptions,
  PreCompletionDiagnosticsResult,
  PreCompletionBlocker,
  DoctorRemedialAction,
  GuidanceGenerationOptions,
  DoctorGuidanceResult,
  DoctorCheckResult,
};

export type {
  DoctorSeverity,
  DoctorDiagnosticFinding,
  DoctorCheckEngineResult,
  DoctorAutoHealResult,
  RepositoryHygieneFinding,
  RepositoryHygieneResult,
  AstPurityFinding,
  GitIndexIntegrityReport,
} from "./types.ts";

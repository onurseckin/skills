export { checkPlanningDag, type PlanningDagCheckOptions } from "./planning-dag-engine.ts";
export {
  checkAstPurity,
  scanFileForAstPurity,
  type AstPurityCheckOptions,
} from "./ast-purity-engine.ts";
export {
  checkAntiMockMutation,
  type AntiMockMutationCheckOptions,
  type CounterfactualCheckRecord,
} from "./anti-mock-engine.ts";
export {
  checkAntiBatchingIsolation,
  type AntiBatchingIsolationOptions,
} from "./anti-batching-engine.ts";
export { checkDualChannelUi, type DualChannelUiCheckOptions } from "./dual-channel-ui-engine.ts";
export {
  checkCognitiveValidatorCommandLock,
  type CognitiveValidatorCommandLockOptions,
} from "./command-lock-engine.ts";
export {
  checkRoleBoundaryInterlock,
  type RoleBoundaryInterlockOptions,
} from "./role-boundary-engine.ts";
export {
  checkPushbackQuotas,
  type PushbackQuotasCheckOptions,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
} from "./pushback-quotas-engine.ts";
export {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
  type RepositoryHygieneOptions,
} from "./hygiene-engine.ts";
export {
  checkGitIndexIntegrity,
  autoHealGitState,
  type GitIndexCheckOptions,
  type AutoHealGitStateOptions,
} from "./git-index-engine.ts";
export {
  cleanseDanglingLocks,
  isProcessAlive,
  recoverStaleLeases,
  type LockCleanerOptions,
} from "./lock-cleaner.ts";
export { checkPolicyDoctor, auditPolicyDoctor, type PolicyDoctorOptions } from "./policy-doctor.ts";
export { autoHealCapsule, quarantineTornTail, type AutoHealOptions } from "./auto-heal.ts";
export {
  checkMailboxHealth,
  autoHealMailboxState,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
  type MailboxHealthOptions,
} from "./mailbox-health-engine.ts";
export {
  checkWorktreeHealth,
  autoHealWorktreeState,
  type DoctorWorktreeHealthReport,
  type WorktreeHealthOptions,
} from "./worktree-health-engine.ts";
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

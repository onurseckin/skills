export {
  auditBehavioralHealth,
  formatBehavioralRoleHealthSection,
  type BehavioralFinding,
  type BehavioralSeverity,
  type BehavioralViolationType,
} from "./behavioral-auditor/index.ts";
export {
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
  type TierConfinementSummary,
  type TierViolationSeverity,
  type TierViolationType,
} from "./doctor/tier-confinement/index.ts";
export {
  evaluateSocraticSelfQuestioning,
  formatSocraticAuditSection,
  type SocraticAuditReport,
  type SocraticDimension,
  type SocraticQuestionEvaluation,
} from "./socratic-validator.ts";
export {
  StateMachineAuditor,
  type LifecycleFinding,
  type LifecycleAuditSummary,
} from "./doctor/state-machine-auditor.ts";
export {
  runDoctorDiagnostics,
  type HarnessHealthCheck,
} from "./doctor/adversarial-doctor/index.ts";
export {
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  checkPolicyDoctor,
  auditPolicyDoctor,
  checkRepositoryHygiene,
  checkGitIndexIntegrity,
  autoHealGitState,
  cleanseDanglingLocks,
  autoHealCapsule,
  checkMailboxHealth,
  checkWorktreeHealth,
  autoHealWorktreeState,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
  type DoctorSeverity,
  type DoctorDiagnosticFinding,
  type DoctorCheckEngineResult,
  type DoctorAutoHealResult,
  type PlanningDagCheckOptions,
  type AstPurityCheckOptions,
  type AntiMockMutationCheckOptions,
  type AntiBatchingIsolationOptions,
  type DualChannelUiCheckOptions,
  type CognitiveValidatorCommandLockOptions,
  type RoleBoundaryInterlockOptions,
  type PushbackQuotasCheckOptions,
  type PolicyDoctorOptions,
  type RepositoryHygieneOptions,
  type GitIndexCheckOptions,
  type AutoHealOptions,
  type MailboxHealthOptions,
  type WorktreeHealthOptions,
  type DoctorWorktreeHealthReport,
} from "./doctor/engines.ts";
export {
  checkPreCompletionDiagnostics,
  type PreCompletionDiagnosticsOptions,
  type PreCompletionDiagnosticsResult,
  type PreCompletionBlocker,
} from "./doctor/pre-completion.ts";
export {
  generateRemedialGuidance,
  remedialActionsForIntegrityIssues,
  type DoctorRemedialAction,
  type GuidanceGenerationOptions,
  type DoctorGuidanceResult,
} from "./doctor/guidance.ts";

export {
  versionAtLeast,
  ignoredByGit,
  classifyIssueSeverity,
  tierDoctorIssues,
  computeCapsuleDoctorFacts,
  type DoctorIssueSeverity,
  type DoctorIssueTiering,
  type CapsuleDoctorFacts,
} from "./doctor/facts.ts";
export { formatDoctorReport, type DoctorReportFormatParams } from "./doctor/report-formatter.ts";
export { runDoctor, type DoctorOptions } from "./doctor/runner.ts";

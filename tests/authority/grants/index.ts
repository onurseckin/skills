/**
 * Authority Grants & Guards Subdomain Test Facade.
 * Explicit named exports for guard contracts, validators, and lease mechanisms.
 */

export {
  assertCoordinatorPreToolGuard,
  isCoordinatorFileEditForbidden,
  isCoordinatorRole,
} from "../../../olt/scripts/src/authority/guards/coordinator-tool-guard.ts";

export { RootDirectoryHygieneGuard } from "../../../olt/scripts/src/authority/guards/root-hygiene.ts";

export {
  acquireAuditorLeaseLock,
  releaseAuditorLeaseLock,
  readAuditorLeaseLock,
  assertSingletonSkillAuditor,
  defaultIsPidAlive,
  DEFAULT_AUDITOR_LEASE_DURATION_MS,
  DEFAULT_AUDITOR_LOCK_FILE,
  type AuditorLeaseLock,
  type AcquireAuditorLeaseOptions,
  type ReleaseAuditorLeaseOptions,
} from "../../../olt/scripts/src/authority/guards/singleton-auditor-guard.ts";

export {
  validateSubagentSpawnRequest,
  rejectDuplicateAuditorSpawn,
  isSingletonAuditorRole,
  DEFAULT_SINGLETON_AUDITOR_ROLE,
  DUPLICATE_SINGLETON_AUDITOR_MESSAGE,
  type SubagentSpawnRequest,
  type SpawnValidationResult,
} from "../../../olt/scripts/src/authority/guards/spawn-validator.ts";

export {
  TimerProtectionGuard,
  type CallerContext,
  type ManagedTaskContext,
} from "../../../olt/scripts/src/authority/guards/timer-protection.ts";

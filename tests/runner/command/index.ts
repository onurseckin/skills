/**
 * Runner Command Subdomain Test Facade.
 * Explicit named exports for command preparation, execution, mutex locks, and policy evaluation.
 */

export {
  runCommand,
  prepareCommand,
  executePreparedCommand,
  acquireMutexLock,
  isBroadScopeTest,
  createInternalCommandRunner,
  setExecutionLockDependenciesForTesting,
  commandId,
  canonicalCommandFingerprint,
  sameCommandJson,
  commandLayers,
  effectiveCommandArgv,
  type InternalCommandRunner,
  type CommandLayers,
  type ExecutionLockDependencies,
} from "../../../olt/scripts/src/engine/runner/models/index.ts";

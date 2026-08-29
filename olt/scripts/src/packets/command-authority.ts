export {
  isMechanicValidatorRole,
  isCognitiveValidatorRole,
  EXECUTION_COMMANDS,
  PROHIBITED_COGNITIVE_TOOL_CATEGORIES,
  PROHIBITED_COGNITIVE_TOOLS,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  assertCognitiveValidatorHardlock,
} from "./command-authority-predicates.ts";

export {
  roleToTier,
  type HierarchicalSpawningCheck,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  BRANCH_WORKER_ROLES,
  isBranchWorkerSpawn,
  assertSpawnAuthorized,
} from "./command-authority-hierarchy.ts";

export {
  type AuthenticatedCaller,
  explicitActingClaim,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "./command-authority-grants.ts";

export { requiresActingIdentity } from "./grant-bootstrap-allowlist.ts";

export {
  type DetectedHost,
  resolveCurrentHost,
  formatHardlockRemediation,
  formatHierarchicalRemediation,
  formatSupervisionRemediation,
  formatDeclaredSpawnRemediation,
  formatRoleContractRemediation,
  formatSessionRemediation,
} from "./command-authority-remediation.ts";

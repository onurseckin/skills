/**
 * Packets Domain Facade.
 * Re-exports subdomains for protocol, serialization, routing, transport, validation, payloads, and headers.
 */

export {
  parseChecklist,
  loadChecklist,
  resolveChecklistPath,
  preplanPacketPort,
  buildPacketAuthContext,
  evaluatePacketPolicy,
  CANONICAL_COMMON_INSTRUCTIONS,
} from "./protocol/index.ts";

export {
  createPacketBundle,
  verifyPacketBundle,
  publishPacket,
  buildEvidenceSchema,
} from "./serialization/index.ts";

export {
  assertGrantedCommand,
  assertSpawnAuthorized,
  spec,
  testCaller,
  installMetaAuditGrant,
  type AuthenticatedCaller,
  getCapsuleCliCommands,
} from "./routing/index.ts";

export {
  collectRepositoryContent,
  captureRepositorySnapshot,
  inspectRepositoryPaths,
  runRepositoryGitCommand,
  spawnRepositoryGitCommand,
  inspectRepositoryGitIdentity,
  captureRepositoryGitMetadata,
} from "./transport/index.ts";

export {
  assertCriticGrant,
  GRANT_BOOTSTRAP_ALLOWLIST,
  PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
  requiresActingIdentity,
  emptyGrantRun,
  seedSingleTaskGraph,
  seedRepositoryInspection,
  seedRunGateCommand,
  type GrantRun,
  authenticatePacketIdentity,
  renderValidationRound,
  validationRoundContext,
  anchoredDiff,
  diffAnchor,
} from "./validation/index.ts";

export {
  CAPSULE_DIRECTORIES,
  CAPSULE_FILES,
  createCapsuleMemoryPointer,
  detectContextBloat,
  formatCapsuleMemoryGuidance,
  partitionDecoupledMemory,
  readDecoupledBlob,
  readDecoupledEvents,
  readDecoupledEvidence,
  readDecoupledState,
  resolveCapsuleDirectory,
  resolveCapsuleFile,
  validateRichInstructionPacket,
  verifyCapsuleLayout,
  verifyCapsuleLayoutSync,
  writeDecoupledBlob,
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
  buildUltraLeanPacket,
  calculatePacketSize,
  createMetadataSlice,
  DEFAULT_BRIEF_MAX_LINES,
  DEFAULT_PACKET_BYTE_BUDGET,
  enforcePacketBudget,
  formatLeanMarkdownBrief,
  parseMarkdownSections,
  sliceAuthoritativeContext,
  sliceEventStream,
  sliceEvidenceLog,
  sliceGraphNeighborhood,
  sliceMarkdownSections,
  sliceRepositoryDiff,
  sliceTaskContract,
  extractAcceptanceCriteria,
  generateDynamicValidationSteps,
  renderDynamicValidationSteps,
  formatDynamicValidationChecklist,
  computeDynamicStepCount,
  validateCognitiveStepCoverage,
  buildDynamicStepsFromWorkflowState,
  buildDynamicStepsFromPacketInput,
  inspection,
  inspectionContext,
} from "./payloads/index.ts";

export {
  parseRoleContract,
  loadRoleContract,
  grantRoleContract,
  type RoleContract,
} from "./headers/index.ts";

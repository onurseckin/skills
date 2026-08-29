export type { AbstractProfile, TierSpawnValidationResult } from "./types.ts";

export {
  ROLE_TIER_MAP,
  ALLOWED_TIER_SPAWNS,
  ABSTRACT_PROFILES,
  PROHIBITED_MODEL_PATTERNS,
  PROHIBITED_TELEMETRY_KEYS,
  validateTierSpawn,
  assertTierSpawn,
  validateAbstractProfile,
  assertAbstractProfile,
} from "./types.ts";

export type { Tier1DeploymentPacketInput, Tier1DeploymentPacket } from "./builder.ts";

export {
  assertNoModelTelemetry,
  resolveOrchestratorContractSha256,
  buildTier1DeploymentPacket,
  buildTier1DeploymentPacket as deployHierarchy,
  createTier1DeployInputFromCandidate,
} from "./builder.ts";

export { loadMindContract } from "./validator.ts";

export { atomicAdmissionToDispatch, enforceIsolatedTaskDispatch } from "./types.ts";

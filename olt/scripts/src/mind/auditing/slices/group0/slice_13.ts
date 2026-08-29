import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
export type RoleAuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type RoleAuditCategory =
  | "boundary"
  | "anti_boundary_leak"
  | "cognitive_pillars"
  | "write_scope"
  | "command_authorization"
  | "duplicate_persona"
  | "spawning_hierarchy"
  | "validator_hardlock"
  | "drift";

export interface RoleAuditFinding {
  readonly id: string;
  readonly roleName: string;
  readonly tier: number;
  readonly category: RoleAuditCategory;
  readonly severity: RoleAuditSeverity;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface PersonaSignature {
  readonly signatureHash: string;
  readonly archetype: RoleArchetype;
  readonly tier: number;
  readonly domain: string;
  readonly writeScopePolicy: WriteScopePolicy;
  readonly commandSetHash: string;
  readonly pillarSetHash: string;
  readonly normalizedSummary: string;
}

export interface PersonaSimilarityMetrics {
  readonly roleA: string;
  readonly roleB: string;
  readonly exactMatch: boolean;
  readonly similarityScore: number; // 0.0 to 1.0
  readonly sharedCommandsCount: number;
  readonly sharedPillarsCount: number;
  readonly sameDomain: boolean;
  readonly sameArchetype: boolean;
  readonly sameWritePolicy: boolean;
}

export interface NonDuplicateRoleSynthesisResult {
  readonly contract: DynamicRoleContract;
  readonly action: "synthesized_new" | "reused_existing" | "synthesized_disambiguated";
  readonly deduplicated: boolean;
  readonly signature: PersonaSignature;
  readonly duplicateOfRole?: string | undefined;
  readonly disambiguatedFrom?: string | undefined;
  readonly message: string;
}

export interface SynthesizeNonDuplicateRoleOptions {
  readonly name: string;
  readonly archetype: RoleArchetype;
  readonly tier?: number | undefined;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly domain?: string | undefined;
  readonly grantedCommands?: readonly string[] | undefined;
  readonly permittedActivities?: readonly string[] | undefined;
  readonly prohibitedActions?: readonly string[] | undefined;
  readonly invariants?: readonly string[] | undefined;
  readonly spawns?: readonly string[] | undefined;
  readonly cognitivePillars?: readonly string[] | undefined;
  readonly writeScopePolicy?: WriteScopePolicy | undefined;
  readonly version?: number | undefined;
  readonly parentRole?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly allowReuseExisting?: boolean | undefined;
  readonly autoDisambiguate?: boolean | undefined;
  readonly similarityThreshold?: number | undefined;
}

export interface RoleAuditOptions {
  readonly strictAntiLeak?: boolean | undefined;
  readonly checkDuplicates?: boolean | undefined;
  readonly checkHierarchy?: boolean | undefined;
  readonly checkCommands?: boolean | undefined;
  readonly minCognitivePillars?: number | undefined;
  readonly duplicateSimilarityThreshold?: number | undefined;
  readonly activeLeaseRoles?: readonly string[] | undefined;
}

export interface RoleAuditSummary {
  readonly totalRolesAudited: number;
  readonly passedRolesCount: number;
  readonly flaggedRolesCount: number;
  readonly criticalFindingsCount: number;
  readonly highFindingsCount: number;
  readonly mediumFindingsCount: number;
  readonly lowFindingsCount: number;
  readonly duplicateClustersCount: number;
  readonly overallPassed: boolean;
}

export interface RoleAuditReport {
  readonly auditedAt: string;
  readonly summary: RoleAuditSummary;
  readonly findings: readonly RoleAuditFinding[];
  readonly checkedRoles: readonly string[];
  readonly duplicatePairs: readonly PersonaSimilarityMetrics[];
  readonly markdownReport: string;
}

export function computePersonaSignature(
  specOrContract: DynamicRoleSpec | DynamicRoleContract,
): PersonaSignature {
  const spec: DynamicRoleSpec = "spec" in specOrContract ? specOrContract.spec : specOrContract;

  const normalizedDomain = (spec.domain ?? "general").trim().toLowerCase();
  const sortedCommands = [...spec.grantedCommands].map((c) => c.trim().toLowerCase()).sort();
  const sortedPillars = [...spec.cognitivePillars].map((p) => p.trim().toLowerCase()).sort();

  const commandSetHash = createHash("sha256")
    .update(sortedCommands.join("|"))
    .digest("hex")
    .slice(0, 16);

  const pillarSetHash = createHash("sha256")
    .update(sortedPillars.join("|"))
    .digest("hex")
    .slice(0, 16);

  const normalizedSummary = spec.summary.trim().replace(/\s+/gu, " ").toLowerCase();

  const compositeKey = [
    spec.archetype,
    `tier:${spec.tier}`,
    `domain:${normalizedDomain}`,
    `write:${spec.writeScopePolicy}`,
    `cmds:${commandSetHash}`,
    `pillars:${pillarSetHash}`,
  ].join("::");

  const signatureHash = createHash("sha256").update(compositeKey).digest("hex");

  return {
    signatureHash,
    archetype: spec.archetype,
    tier: spec.tier,
    domain: normalizedDomain,
    writeScopePolicy: spec.writeScopePolicy,
    commandSetHash,
    pillarSetHash,
    normalizedSummary,
  };
}

export function calculatePersonaSimilarity(
  a: DynamicRoleSpec | DynamicRoleContract,
  b: DynamicRoleSpec | DynamicRoleContract,
): PersonaSimilarityMetrics {
  const specA: DynamicRoleSpec = "spec" in a ? a.spec : a;
  const specB: DynamicRoleSpec = "spec" in b ? b.spec : b;

  const sigA = computePersonaSignature(specA);
  const sigB = computePersonaSignature(specB);

  if (sigA.signatureHash === sigB.signatureHash) {
    return {
      roleA: specA.name,
      roleB: specB.name,
      exactMatch: true,
      similarityScore: 1.0,
      sharedCommandsCount: specA.grantedCommands.length,
      sharedPillarsCount: specA.cognitivePillars.length,
      sameDomain: true,
      sameArchetype: true,
      sameWritePolicy: true,
    };
  }

  const setCommandsA = new Set(specA.grantedCommands.map((c) => c.toLowerCase()));
  const setCommandsB = new Set(specB.grantedCommands.map((c) => c.toLowerCase()));
  const sharedCommands = [...setCommandsA].filter((c) => setCommandsB.has(c));
  const unionCommands = new Set([...setCommandsA, ...setCommandsB]);
  const commandJaccard =
    unionCommands.size === 0 ? 1.0 : sharedCommands.length / unionCommands.size;

  const setPillarsA = new Set(specA.cognitivePillars.map((p) => p.toLowerCase()));
  const setPillarsB = new Set(specB.cognitivePillars.map((p) => p.toLowerCase()));
  const sharedPillars = [...setPillarsA].filter((p) => setPillarsB.has(p));
  const unionPillars = new Set([...setPillarsA, ...setPillarsB]);
  const pillarJaccard = unionPillars.size === 0 ? 1.0 : sharedPillars.length / unionPillars.size;

  const sameArchetype = specA.archetype === specB.archetype;
  const sameDomain = (specA.domain ?? "general") === (specB.domain ?? "general");
  const sameWritePolicy = specA.writeScopePolicy === specB.writeScopePolicy;

  let weightedScore = 0;
  if (sameArchetype) weightedScore += 0.3;
  if (sameDomain) weightedScore += 0.2;
  if (sameWritePolicy) weightedScore += 0.1;
  weightedScore += commandJaccard * 0.25;
  weightedScore += pillarJaccard * 0.15;

  const similarityScore = Math.min(1.0, Math.round(weightedScore * 100) / 100);

  return {
    roleA: specA.name,
    roleB: specB.name,
    exactMatch: false,
    similarityScore,
    sharedCommandsCount: sharedCommands.length,
    sharedPillarsCount: sharedPillars.length,
    sameDomain,
    sameArchetype,
    sameWritePolicy,
  };
}

export function findSimilarPersonas(
  target: DynamicRoleSpec | DynamicRoleContract,
  roles: readonly (DynamicRoleSpec | DynamicRoleContract)[],
  threshold = 0.85,
): readonly PersonaSimilarityMetrics[] {
  const matches: PersonaSimilarityMetrics[] = [];
  const targetSpec: DynamicRoleSpec = "spec" in target ? target.spec : target;

  for (const other of roles) {
    const otherSpec: DynamicRoleSpec = "spec" in other ? other.spec : other;
    if (otherSpec.name === targetSpec.name) {
      continue;
    }

    const similarity = calculatePersonaSimilarity(targetSpec, otherSpec);
    if (similarity.exactMatch || similarity.similarityScore >= threshold) {
      matches.push(similarity);
    }
  }

  return matches;
}
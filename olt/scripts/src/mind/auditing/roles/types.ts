import type {
  DynamicRoleContract,
  DynamicRoleSpec,
  RoleArchetype,
  WriteScopePolicy,
} from "../../roles/dynamic/types.ts";

export interface PersonaSignature {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly archetype: RoleArchetype;
  readonly commandsSignature: string;
  readonly writeScopePolicy: WriteScopePolicy;
  readonly invariantsHash: string;
  readonly signatureHash: string;
}

export type RoleAuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface PersonaSimilarityMetrics {
  readonly roleA: string;
  readonly roleB: string;
  readonly commandsJaccard: number;
  readonly invariantsJaccard: number;
  readonly pillarsJaccard: number;
  readonly similarityScore: number;
  readonly exactMatch: boolean;
  readonly sameArchetype: boolean;
  readonly sameDomain: boolean;
  readonly sameWritePolicy: boolean;
  readonly sharedCommandsCount: number;
  readonly sharedPillarsCount: number;
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
  readonly summary?: string | undefined;
  readonly domain?: string | undefined;
  readonly title?: string | undefined;
  readonly requirements?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly gates?: readonly string[] | undefined;
  readonly allowReuseExisting?: boolean | undefined;
  readonly autoDisambiguate?: boolean | undefined;
  readonly similarityThreshold?: number | undefined;
  readonly writeScopePolicy?: WriteScopePolicy | undefined;
  readonly roleRegistryRoot?: string | undefined;
  readonly grantedCommands?: readonly string[] | undefined;
  readonly cognitivePillars?: readonly string[] | undefined;
  readonly prohibitedActions?: readonly string[] | undefined;
}

export interface RoleAuditFinding {
  readonly id: string;
  readonly roleName: string;
  readonly tier: number;
  readonly category:
    | "command_authorization"
    | "spawning_hierarchy"
    | "anti_boundary_leak"
    | "cognitive_pillars"
    | "scope_confinement"
    | "contract_format"
    | "duplicate_persona";
  readonly severity: RoleAuditSeverity;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  readonly evidence?: Record<string, unknown> | undefined;
}

export interface RoleAuditOptions {
  readonly rolesDir?: string | undefined;
  readonly includeBuiltins?: boolean | undefined;
  readonly throwOnFailure?: boolean | undefined;
  readonly format?: "json" | "markdown" | "table" | undefined;
  readonly minCognitivePillars?: number | undefined;
  readonly checkDuplicates?: boolean | undefined;
  readonly duplicateSimilarityThreshold?: number | undefined;
}

export interface RoleAuditSummary {
  readonly totalRoles: number;
  readonly totalRolesAudited: number;
  readonly validRoles: number;
  readonly invalidRoles: number;
  readonly passedRolesCount: number;
  readonly flaggedRolesCount: number;
  readonly criticalFindings: number;
  readonly criticalFindingsCount: number;
  readonly highFindings: number;
  readonly highFindingsCount: number;
  readonly mediumFindingsCount: number;
  readonly lowFindingsCount: number;
  readonly duplicateClustersCount: number;
  readonly overallPassed: boolean;
}

export interface RoleAuditReport {
  readonly auditedAt: string;
  readonly rolesDir?: string | undefined;
  readonly summary: RoleAuditSummary;
  readonly findings: readonly RoleAuditFinding[];
  readonly duplicatePairs: readonly PersonaSimilarityMetrics[];
  readonly markdownReport: string;
  readonly valid?: boolean | undefined;
  readonly checkedRoles?: readonly string[] | undefined;
}

export type ContractAuditReport = RoleAuditReport;

export {
  calculatePersonaSimilarity,
  computePersonaSignature,
  findSimilarPersonas,
} from "./similarity.ts";

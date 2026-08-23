import { createHash } from "node:crypto";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { logBoundaryViolationDefect, type DefectEntry } from "./defects.ts";
import {
  type DynamicRoleContract,
  type DynamicRoleRegistry,
  type DynamicRoleSpec,
  type RoleArchetype,
  type WriteScopePolicy,
  getGlobalRoleRegistry,
  synthesizeDynamicRole,
  validateDynamicRoleSpec,
} from "./dynamic-roles.ts";

/**
 * Severity levels for role audit findings.
 */
export type RoleAuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/**
 * Categories for role audit findings.
 */
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

/**
 * Individual finding produced by autonomous role auditing.
 */
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

/**
 * Structural persona signature used for deterministic deduplication.
 */
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

/**
 * Similarity comparison metrics between two dynamic roles.
 */
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

/**
 * Result of non-duplicate persona synthesis.
 */
export interface NonDuplicateRoleSynthesisResult {
  readonly contract: DynamicRoleContract;
  readonly action: "synthesized_new" | "reused_existing" | "synthesized_disambiguated";
  readonly deduplicated: boolean;
  readonly signature: PersonaSignature;
  readonly duplicateOfRole?: string | undefined;
  readonly disambiguatedFrom?: string | undefined;
  readonly message: string;
}

/**
 * Options for synthesizing a non-duplicate persona.
 */
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

/**
 * Role audit configuration and context.
 */
export interface RoleAuditOptions {
  readonly strictAntiLeak?: boolean | undefined;
  readonly checkDuplicates?: boolean | undefined;
  readonly checkHierarchy?: boolean | undefined;
  readonly checkCommands?: boolean | undefined;
  readonly minCognitivePillars?: number | undefined;
  readonly duplicateSimilarityThreshold?: number | undefined;
  readonly activeLeaseRoles?: readonly string[] | undefined;
}

/**
 * Summary metrics of an autonomous role audit.
 */
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

/**
 * Comprehensive autonomous role audit report.
 */
export interface RoleAuditReport {
  readonly auditedAt: string;
  readonly summary: RoleAuditSummary;
  readonly findings: readonly RoleAuditFinding[];
  readonly checkedRoles: readonly string[];
  readonly duplicatePairs: readonly PersonaSimilarityMetrics[];
  readonly markdownReport: string;
}

/**
 * Computes a normalized SHA-256 persona signature for a dynamic role.
 */
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

/**
 * Calculates similarity metrics between two dynamic role contracts or specs.
 */
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

/**
 * Finds all similar or duplicate personas in a role catalog.
 */
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

/**
 * Synthesizes a dynamic role ensuring no duplicate or redundant persona is created.
 * Reuses existing identical contracts or disambiguates naming automatically.
 */
export function synthesizeNonDuplicatePersona(
  options: SynthesizeNonDuplicateRoleOptions,
  registry?: DynamicRoleRegistry,
): NonDuplicateRoleSynthesisResult {
  const reg = registry ?? getGlobalRoleRegistry();
  const allowReuse = options.allowReuseExisting ?? true;
  const autoDisambiguate = options.autoDisambiguate ?? true;
  const threshold = options.similarityThreshold ?? 0.95;

  const targetContract = synthesizeDynamicRole(options);
  const targetSignature = computePersonaSignature(targetContract);

  // Check for exact matching persona in the registry
  if (allowReuse) {
    for (const existing of reg.list()) {
      const existingSig = computePersonaSignature(existing);
      if (existingSig.signatureHash === targetSignature.signatureHash) {
        return {
          contract: existing,
          action: "reused_existing",
          deduplicated: true,
          signature: existingSig,
          duplicateOfRole: existing.role,
          message: `Identical persona signature found for role '${existing.role}'. Reused existing contract without redundant synthesis.`,
        };
      }
    }
  }

  // Check if role name collides with a different contract
  if (reg.has(options.name)) {
    const existing = reg.get(options.name);
    if (existing && existing.sha256 === targetContract.sha256) {
      return {
        contract: existing,
        action: "reused_existing",
        deduplicated: true,
        signature: targetSignature,
        duplicateOfRole: existing.role,
        message: `Role with identical name '${options.name}' and identical content already registered. Reused existing contract.`,
      };
    }

    if (!autoDisambiguate) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Role name '${options.name}' already exists in registry with different specification. Enable autoDisambiguate or specify a unique name.`,
      );
    }

    // Disambiguate name with sequential or domain-based suffix
    const baseName = options.name;
    let counter = 2;
    let disambiguatedName = `${baseName}-v${counter}`;
    while (reg.has(disambiguatedName)) {
      counter++;
      disambiguatedName = `${baseName}-v${counter}`;
    }

    const disambiguatedOptions: SynthesizeNonDuplicateRoleOptions = {
      ...options,
      name: disambiguatedName,
      version: counter,
      parentRole: options.parentRole ?? baseName,
    };

    const disambiguatedContract = synthesizeDynamicRole(disambiguatedOptions);
    const disambiguatedSig = computePersonaSignature(disambiguatedContract);
    reg.register(disambiguatedContract);

    return {
      contract: disambiguatedContract,
      action: "synthesized_disambiguated",
      deduplicated: false,
      signature: disambiguatedSig,
      disambiguatedFrom: baseName,
      message: `Name collision resolved: Synthesized disambiguated persona '${disambiguatedName}' (version v${counter}) evolved from '${baseName}'.`,
    };
  }

  // Check for high similarity near-duplicate warning
  const similarRoles = findSimilarPersonas(targetContract, reg.list(), threshold);
  reg.register(targetContract);

  if (similarRoles.length > 0) {
    const mostSimilar = similarRoles[0]!;
    return {
      contract: targetContract,
      action: "synthesized_new",
      deduplicated: false,
      signature: targetSignature,
      duplicateOfRole: mostSimilar.roleB,
      message: `Synthesized new persona '${targetContract.role}'. Note: High similarity (${Math.round(mostSimilar.similarityScore * 100)}%) to existing role '${mostSimilar.roleB}'.`,
    };
  }

  return {
    contract: targetContract,
    action: "synthesized_new",
    deduplicated: false,
    signature: targetSignature,
    message: `Synthesized new unique dynamic persona '${targetContract.role}'.`,
  };
}

/**
 * Audits a single dynamic role specification or contract against architecture invariants.
 */
export function auditSingleRole(
  role: DynamicRoleSpec | DynamicRoleContract,
  options: RoleAuditOptions = {},
): readonly RoleAuditFinding[] {
  const findings: RoleAuditFinding[] = [];
  const spec: DynamicRoleSpec = "spec" in role ? role.spec : role;

  const minPillars = options.minCognitivePillars ?? 2;
  const strictAntiLeak = options.strictAntiLeak ?? true;
  const checkHierarchy = options.checkHierarchy ?? true;
  const checkCommands = options.checkCommands ?? true;

  // 1. Basic Specification Validation
  const specValidation = validateDynamicRoleSpec(spec);
  if (!specValidation.valid) {
    for (const err of specValidation.errors) {
      findings.push({
        id: `FIND-SPEC-${spec.name}-${findings.length + 1}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "boundary",
        severity: "CRITICAL",
        title: "Dynamic Role Specification Invalid",
        description: err,
        recommendation: "Update role specification to comply with dynamic role constraints.",
      });
    }
  }

  // 2. Anti-Boundary-Leak Enforcement & Cognitive Validator Hard-Lock for Validators & Critics
  if (
    strictAntiLeak &&
    (spec.archetype === "tier_3_validator" ||
      spec.archetype === "tier_3_critic" ||
      isCognitiveValidatorRole(spec.name))
  ) {
    if (spec.writeScopePolicy !== "forbidden") {
      findings.push({
        id: `FIND-LEAK-WRITE-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "CRITICAL",
        title: "Anti-Boundary-Leak: Write Scope Policy Violation",
        description: `Validator role '${spec.name}' declared writeScopePolicy '${spec.writeScopePolicy}'. Validators must be strictly read-only ('forbidden').`,
        recommendation: "Set writeScopePolicy to 'forbidden' for all validators and critics.",
        evidence: { writeScopePolicy: spec.writeScopePolicy },
      });
    }

    const hasWritePermission = spec.permittedActivities.some(
      (act) =>
        act.toLowerCase().includes("write") ||
        act.toLowerCase().includes("edit") ||
        act.toLowerCase().includes("claim lease") ||
        act.toLowerCase().includes("modify file"),
    );
    if (hasWritePermission) {
      findings.push({
        id: `FIND-LEAK-MAY-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "CRITICAL",
        title: "Anti-Boundary-Leak: Write Permission in Permitted Activities",
        description: `Validator role '${spec.name}' contains file write/edit actions in permitted activities.`,
        recommendation: "Remove file modification permissions from validator permitted activities.",
      });
    }

    const hasAntiLeakMustNot = spec.prohibitedActions.some(
      (act) =>
        act.toLowerCase().includes("claim code write lease") ||
        act.toLowerCase().includes("edit source") ||
        act.toLowerCase().includes("write files") ||
        act.toLowerCase().includes("anti-boundary-leak"),
    );
    if (!hasAntiLeakMustNot) {
      findings.push({
        id: `FIND-LEAK-MUSTNOT-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "HIGH",
        title: "Anti-Boundary-Leak: Missing Explicit Prohibition",
        description: `Validator role '${spec.name}' lacks explicit Anti-Boundary-Leak prohibition in must_not declarations.`,
        recommendation:
          "Add explicit prohibition 'Claim code write leases or edit source files (Anti-Boundary-Leak Rule)' to must_not.",
      });
    }

    // Cognitive Validator Hard-Lock Interlock verification
    if (!isMechanicValidatorRole(spec.name)) {
      const prohibitedExecutionCmds = spec.grantedCommands.filter((cmd) => {
        const c = cmd.toLowerCase().trim();
        return (
          c === "run:exec" ||
          c === "bash" ||
          c === "sh" ||
          c === "zsh" ||
          c === "exec" ||
          c === "bun test" ||
          c === "npm test" ||
          c === "pytest" ||
          c === "cargo test" ||
          c.includes("test-runner") ||
          c.startsWith("run:exec")
        );
      });
      if (prohibitedExecutionCmds.length > 0) {
        findings.push({
          id: `FIND-HARDLOCK-CMD-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "validator_hardlock",
          severity: "CRITICAL",
          title: "Cognitive Validator Hard-Lock: Execution Command Granted",
          description: `Cognitive validator role '${spec.name}' was granted prohibited execution command(s) [${prohibitedExecutionCmds.join(", ")}]. Cognitive Validators and Critics are strictly banned from executing bash, shell commands, test runners, build tools, or package managers.`,
          recommendation:
            "Remove all execution commands ('run:exec', test runners, shell commands) from cognitive validator granted commands. Test execution authority belongs exclusively to Mechanic Validators.",
          evidence: {
            grantedCommands: spec.grantedCommands,
            prohibitedCommands: prohibitedExecutionCmds,
          },
        });
      }

      const hasHardlockMustNot = spec.prohibitedActions.some((act) => {
        const a = act.toLowerCase();
        return (
          a.includes("run:exec") ||
          a.includes("execute bash") ||
          a.includes("shell command") ||
          a.includes("test suite") ||
          a.includes("validator hard-lock") ||
          a.includes("hard-lock") ||
          a.includes("package manager") ||
          a.includes("build tool")
        );
      });
      if (!hasHardlockMustNot) {
        findings.push({
          id: `FIND-HARDLOCK-MUSTNOT-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "validator_hardlock",
          severity: "HIGH",
          title: "Cognitive Validator Hard-Lock: Missing Explicit Prohibition",
          description: `Validator role '${spec.name}' lacks explicit Cognitive Validator Hard-Lock prohibition in must_not declarations.`,
          recommendation:
            "Add explicit prohibition 'Execute test suites, bash/shell commands, build tools, or package managers (Cognitive Validator Hard-Lock Rule)' to must_not.",
        });
      }
    }
  }

  // 3. Spawning Hierarchy & Parent-Child Boundary Validation
  if (checkHierarchy) {
    if (spec.tier === 3 && spec.spawns.length > 0) {
      findings.push({
        id: `FIND-HIER-SPAWN3-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 3 Leaf Spawning Violation",
        description: `Tier 3 role '${spec.name}' declared child spawns [${spec.spawns.join(", ")}]. Tier 3 roles are leaf execution workers and cannot spawn subagents.`,
        recommendation: "Clear spawns array for Tier 3 roles.",
      });
    }

    if (spec.tier === 0 && spec.spawns.some((s) => !isOrchestratorRole(s))) {
      findings.push({
        id: `FIND-HIER-SPAWN0-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 0 Cross-Tier Spawning Violation",
        description: `Tier 0 Mind declared child spawns [${spec.spawns.join(", ")}]. Mind may only dispatch Tier 1 Orchestrator.`,
        recommendation: "Set spawns to strictly ['orchestrator'].",
      });
    }

    if (spec.tier === 1 && spec.spawns.some((s) => !isCoordinatorRole(s))) {
      findings.push({
        id: `FIND-HIER-SPAWN1-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 1 Cross-Tier Spawning Violation",
        description: `Tier 1 Orchestrator declared child spawns [${spec.spawns.join(", ")}]. Orchestrator may only dispatch Tier 2 Coordinator.`,
        recommendation: "Set spawns to strictly ['coordinator'].",
      });
    }

    if (
      spec.tier === 2 &&
      spec.spawns.some(
        (s) => isMindRole(s) || isOrchestratorRole(s) || isCoordinatorRole(s) || roleToTier(s) < 3,
      )
    ) {
      findings.push({
        id: `FIND-HIER-SPAWN2-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 2 Cross-Tier Spawning Violation",
        description: `Tier 2 Coordinator declared non-Tier-3 child spawns [${spec.spawns.join(", ")}]. Coordinators may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers).`,
        recommendation: "Set spawns to strictly Tier 3 role names.",
      });
    }

    if (spec.parentRole) {
      if (spec.tier === 0) {
        findings.push({
          id: `FIND-HIER-PARENT0-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 0 Root Hierarchy Violation",
          description: `Tier 0 Mind declared parent role '${spec.parentRole}'. Tier 0 Mind is root supervisory authority and cannot have a parent role.`,
          recommendation: "Remove parentRole from Tier 0 Mind role specification.",
        });
      } else if (spec.tier === 1 && !isMindRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT1-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 1 Parent Supervision Violation",
          description: `Tier 1 Orchestrator declared invalid parent role '${spec.parentRole}'. Orchestrator must be supervised by Tier 0 Mind.`,
          recommendation: "Set parentRole to 'mind'.",
        });
      } else if (spec.tier === 2 && !isOrchestratorRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT2-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 2 Parent Supervision Violation",
          description: `Tier 2 Coordinator declared invalid parent role '${spec.parentRole}'. Coordinator must be supervised by Tier 1 Orchestrator.`,
          recommendation: "Set parentRole to 'orchestrator'.",
        });
      } else if (spec.tier === 3 && !isCoordinatorRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT3-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 3 Parent Supervision Violation",
          description: `Tier 3 worker declared invalid parent role '${spec.parentRole}'. Tier 3 workers must be supervised by Tier 2 Coordinator.`,
          recommendation: "Set parentRole to 'coordinator'.",
        });
      }
    }
  }

  // 4. Command Authorization & Forbidden Commands
  if (checkCommands) {
    if (spec.grantedCommands.includes("orchestrator:run")) {
      findings.push({
        id: `FIND-CMD-ORCHRUN-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "command_authorization",
        severity: "CRITICAL",
        title: "Forbidden Command 'orchestrator:run' Granted",
        description: `Role '${spec.name}' was granted 'orchestrator:run', which is strictly forbidden across all role specifications.`,
        recommendation: "Remove 'orchestrator:run' from granted commands.",
      });
    }

    if (spec.tier < 3 && spec.grantedCommands.includes("task:claim")) {
      findings.push({
        id: `FIND-CMD-SUPERCLAIM-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "command_authorization",
        severity: "HIGH",
        title: "Supervisory Task Claiming Command Granted",
        description: `Supervisory role '${spec.name}' (Tier ${spec.tier}) was granted 'task:claim'. Supervisors must delegate tasks, not claim them.`,
        recommendation: "Remove 'task:claim' from supervisory role commands.",
      });
    }
  }

  // 5. Cognitive Pillars & Zero-Any Discipline
  if (spec.cognitivePillars.length < minPillars) {
    findings.push({
      id: `FIND-PILLAR-COUNT-${spec.name}`,
      roleName: spec.name,
      tier: spec.tier,
      category: "cognitive_pillars",
      severity: "MEDIUM",
      title: "Insufficient Cognitive Pillars",
      description: `Role '${spec.name}' has ${spec.cognitivePillars.length} cognitive pillars defined (minimum recommended: ${minPillars}).`,
      recommendation: "Add explicit cognitive pillars to guide role execution posture.",
    });
  }

  const hasZeroAnyPillar =
    spec.cognitivePillars.some(
      (p) =>
        p.toLowerCase().includes("zero-any") ||
        p.toLowerCase().includes("type safety") ||
        p.toLowerCase().includes("strict type"),
    ) ||
    spec.invariants.some(
      (i) => i.toLowerCase().includes("zero-any") || i.toLowerCase().includes("zero any"),
    );

  if (spec.tier === 3 && spec.archetype === "tier_3_implementer" && !hasZeroAnyPillar) {
    findings.push({
      id: `FIND-PILLAR-ZEROANY-${spec.name}`,
      roleName: spec.name,
      tier: spec.tier,
      category: "cognitive_pillars",
      severity: "LOW",
      title: "Missing Explicit Zero-Any TypeScript Pillar",
      description: `Implementer role '${spec.name}' does not explicitly cite the Zero-Any TypeScript discipline.`,
      recommendation:
        "Include 'Strict Zero-Any & Zero-Suppression TypeScript Discipline' in cognitive pillars.",
    });
  }

  return findings;
}

/**
 * Audits a collection of dynamic roles or a complete role registry.
 */
export function auditDynamicRoles(
  roles: readonly (DynamicRoleSpec | DynamicRoleContract)[],
  options: RoleAuditOptions = {},
): RoleAuditReport {
  const auditedAt = new Date().toISOString();
  const findings: RoleAuditFinding[] = [];
  const checkedRoles: string[] = [];
  const duplicatePairs: PersonaSimilarityMetrics[] = [];

  const checkDuplicates = options.checkDuplicates ?? true;
  const duplicateThreshold = options.duplicateSimilarityThreshold ?? 0.9;

  // Audit each role individually
  for (const role of roles) {
    const spec: DynamicRoleSpec = "spec" in role ? role.spec : role;
    checkedRoles.push(spec.name);
    const singleFindings = auditSingleRole(spec, options);
    findings.push(...singleFindings);
  }

  // Cross-role duplicate detection
  if (checkDuplicates) {
    const seenPairs = new Set<string>();

    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const roleA = roles[i]!;
        const roleB = roles[j]!;
        const specA: DynamicRoleSpec = "spec" in roleA ? roleA.spec : roleA;
        const specB: DynamicRoleSpec = "spec" in roleB ? roleB.spec : roleB;

        const pairKey = [specA.name, specB.name].sort().join("::");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const similarity = calculatePersonaSimilarity(specA, specB);
        if (similarity.exactMatch || similarity.similarityScore >= duplicateThreshold) {
          duplicatePairs.push(similarity);

          const severity: RoleAuditSeverity = similarity.exactMatch ? "HIGH" : "MEDIUM";
          findings.push({
            id: `FIND-DUP-${specA.name}-${specB.name}`,
            roleName: specA.name,
            tier: specA.tier,
            category: "duplicate_persona",
            severity,
            title: similarity.exactMatch
              ? `Duplicate Persona Signature Detected (${specA.name} == ${specB.name})`
              : `High Persona Similarity Detected (${specA.name} ~ ${specB.name})`,
            description: `Roles '${specA.name}' and '${specB.name}' share identical or near-identical persona signatures (${Math.round(similarity.similarityScore * 100)}% similarity).`,
            recommendation:
              "Consolidate redundant roles into a single dynamic role or disambiguate specialization domains.",
            evidence: {
              roleA: specA.name,
              roleB: specB.name,
              similarityScore: similarity.similarityScore,
              exactMatch: similarity.exactMatch,
            },
          });
        }
      }
    }
  }

  // Tally summary metrics
  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const highCount = findings.filter((f) => f.severity === "HIGH").length;
  const mediumCount = findings.filter((f) => f.severity === "MEDIUM").length;
  const lowCount = findings.filter((f) => f.severity === "LOW").length;

  const flaggedRoleNames = new Set(findings.map((f) => f.roleName));
  const flaggedRolesCount = flaggedRoleNames.size;
  const passedRolesCount = Math.max(0, checkedRoles.length - flaggedRolesCount);
  const overallPassed = criticalCount === 0 && highCount === 0;

  const summary: RoleAuditSummary = {
    totalRolesAudited: checkedRoles.length,
    passedRolesCount,
    flaggedRolesCount,
    criticalFindingsCount: criticalCount,
    highFindingsCount: highCount,
    mediumFindingsCount: mediumCount,
    lowFindingsCount: lowCount,
    duplicateClustersCount: duplicatePairs.length,
    overallPassed,
  };

  const report: RoleAuditReport = {
    auditedAt,
    summary,
    findings,
    checkedRoles,
    duplicatePairs,
    markdownReport: "",
  };

  const markdownReport = formatRoleAuditMarkdown(report);
  return {
    ...report,
    markdownReport,
  };
}

/**
 * Runs an autonomous role audit against the global dynamic role registry.
 */
export function runAutonomousMindRoleAudit(
  registry?: DynamicRoleRegistry,
  options?: RoleAuditOptions,
): RoleAuditReport {
  const reg = registry ?? getGlobalRoleRegistry();
  const roles = reg.list();
  return auditDynamicRoles(roles, options);
}

/**
 * Formats a RoleAuditReport into a clean GitHub-Flavored Markdown summary document.
 */
export function formatRoleAuditMarkdown(
  report: RoleAuditReport,
  options: { readonly compact?: boolean | undefined } = {},
): string {
  const lines: string[] = [];
  const statusEmoji = report.summary.overallPassed ? "🟢 PASS" : "🔴 ACTION REQUIRED";

  lines.push("### 🛡️ Mind Autonomous Role Audit Report");
  lines.push(`- **Status**: ${statusEmoji}`);
  lines.push(`- **Audited At**: \`${report.auditedAt}\``);
  lines.push(
    `- **Roles Audited**: ${report.summary.totalRolesAudited} (${report.summary.passedRolesCount} clean, ${report.summary.flaggedRolesCount} flagged)`,
  );
  lines.push(
    `- **Findings**: ${report.findings.length} (Critical: ${report.summary.criticalFindingsCount}, High: ${report.summary.highFindingsCount}, Medium: ${report.summary.mediumFindingsCount}, Low: ${report.summary.lowFindingsCount})`,
  );
  lines.push(`- **Duplicate Clusters**: ${report.summary.duplicateClustersCount}`);
  lines.push("");

  if (report.duplicatePairs.length > 0) {
    lines.push("#### 🔍 Persona Deduplication & Similarity Clusters");
    for (const dup of report.duplicatePairs) {
      const matchType = dup.exactMatch ? "EXACT DUPLICATE" : "HIGH SIMILARITY";
      lines.push(
        `- **[${matchType}]** \`${dup.roleA}\` ↔ \`${dup.roleB}\` (Similarity: ${Math.round(dup.similarityScore * 100)}%, Shared Commands: ${dup.sharedCommandsCount}, Shared Pillars: ${dup.sharedPillarsCount})`,
      );
    }
    lines.push("");
  }

  if (report.findings.length === 0) {
    lines.push(
      "✅ **Zero role audit findings.** All registered personas adhere strictly to 4-Tier boundaries, Anti-Boundary-Leak invariants, and Zero-Any type discipline.",
    );
    return lines.join("\n").trim();
  }

  if (!options.compact) {
    lines.push("#### ⚠️ Detailed Findings List");
    for (const f of report.findings) {
      lines.push(`##### [${f.severity}] ${f.title} (\`${f.id}\`)`);
      lines.push(
        `- **Role**: \`${f.roleName}\` (Tier ${f.tier}) | **Category**: \`${f.category}\``,
      );
      lines.push(`- **Description**: ${f.description}`);
      lines.push(`- **Remediation**: ${f.recommendation}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

/**
 * Formats a RoleAuditReport as an ASCII status table for CLI logs.
 */
export function renderRoleAuditAsciiTable(report: RoleAuditReport): string {
  if (report.checkedRoles.length === 0) {
    return "(no dynamic roles evaluated)";
  }

  const header = [
    "ROLE".padEnd(28),
    "TIER".padEnd(6),
    "STATUS".padEnd(10),
    "CRITICAL".padEnd(10),
    "HIGH".padEnd(8),
    "MEDIUM".padEnd(8),
  ].join(" | ");

  const divider = "-".repeat(header.length);
  const rows: string[] = [header, divider];

  for (const roleName of report.checkedRoles) {
    const roleFindings = report.findings.filter((f) => f.roleName === roleName);
    const crit = roleFindings.filter((f) => f.severity === "CRITICAL").length;
    const high = roleFindings.filter((f) => f.severity === "HIGH").length;
    const med = roleFindings.filter((f) => f.severity === "MEDIUM").length;

    const status = crit > 0 ? "FAIL" : high > 0 ? "WARN" : "OK";
    const tier = roleFindings[0]?.tier ?? 3;

    rows.push(
      [
        roleName.padEnd(28),
        `Tier ${tier}`.padEnd(6),
        status.padEnd(10),
        String(crit).padEnd(10),
        String(high).padEnd(8),
        String(med).padEnd(8),
      ].join(" | "),
    );
  }

  return rows.join("\n");
}

/**
 * Formats the result of a non-duplicate persona synthesis for logging and telemetry.
 */
export function formatNonDuplicatePersonaSummary(result: NonDuplicateRoleSynthesisResult): string {
  const lines: string[] = [];
  lines.push(`### 🎭 Non-Duplicate Persona Synthesis: \`${result.contract.role}\``);
  lines.push(`- **Action**: \`${result.action}\``);
  lines.push(`- **Tier**: Tier ${result.contract.tier} (\`${result.contract.spec.archetype}\`)`);
  lines.push(`- **Deduplicated**: ${result.deduplicated ? "YES" : "NO"}`);
  lines.push(`- **Signature Hash**: \`${result.signature.signatureHash.slice(0, 16)}...\``);
  lines.push(`- **Message**: ${result.message}`);
  if (result.duplicateOfRole) {
    lines.push(`- **Reused / Similar Role**: \`${result.duplicateOfRole}\``);
  }
  if (result.disambiguatedFrom) {
    lines.push(`- **Disambiguated From**: \`${result.disambiguatedFrom}\``);
  }

  return lines.join("\n").trim();
}

/**
 * Known tool and command subsets for Zero-Tolerance boundary invariant enforcement.
 */
export const CODE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
]);

export const GRAPH_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "plan:enhance",
  "plan:add",
  "plan:compile",
  "plan:apply",
  "plan:replan",
  "plan:claim",
  "mind:init",
  "mind:candidate",
  "mind:admit",
]);

export const VALIDATION_COMMANDS: ReadonlySet<string> = new Set([
  "task:validate-start",
  "task:review",
  "task:probe",
  "task:reject",
  "critic:start",
  "critic:remediate",
  "gate:prove",
  "coordinator:pushback",
]);

/**
 * Role classification and tier detection predicates.
 */
export function isMindRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return r === "mind" || r.startsWith("mind-") || r.includes("mind");
}

export function isOrchestratorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "orchestrator" ||
    r.startsWith("orchestrator-") ||
    r.startsWith("orch-") ||
    r.includes("orchestrator")
  );
}

export function isCoordinatorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "coordinator" ||
    r.startsWith("coordinator-") ||
    r.startsWith("coord-") ||
    r.includes("coordinator")
  );
}

export function isImplementerRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "implementer" ||
    r === "repairer" ||
    r === "sub-implementer" ||
    r === "worker" ||
    r.startsWith("impl-") ||
    r.includes("implementer")
  );
}

export function isValidatorRole(role: string): boolean {
  const r = role.toLowerCase().trim();
  return (
    r === "validator" ||
    r === "sub-validator" ||
    r === "plan-validator" ||
    r === "completeness-critic" ||
    r === "mind-auditor" ||
    r.includes("validator") ||
    r.includes("critic")
  );
}

export function isMechanicValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  return (
    normalized === "mechanic-validator" ||
    normalized === "ui-mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized.startsWith("mechanic-") ||
    normalized.endsWith("-mechanic-validator")
  );
}

export function isCognitiveValidatorRole(role: string): boolean {
  const normalized = role.toLowerCase().trim();
  if (isMechanicValidatorRole(normalized)) return false;
  return (
    normalized === "validator" ||
    normalized === "ui-validator" ||
    normalized.startsWith("validator-")
  );
}

export const PROHIBITED_COGNITIVE_TOOL_CATEGORIES: ReadonlySet<string> = new Set([
  "shell",
  "test-runner",
  "build",
  "package-manager",
  "bash",
  "terminal",
  "exec",
]);

export const PROHIBITED_COGNITIVE_TOOLS: ReadonlySet<string> = new Set([
  "run_command",
  "bash",
  "sh",
  "zsh",
  "exec",
  "terminal",
  "test_runner",
  "bun_test",
  "npm_test",
]);

export function roleToTier(role: string): number {
  if (isMindRole(role)) return 0;
  if (isOrchestratorRole(role)) return 1;
  if (isCoordinatorRole(role)) return 2;
  return 3;
}

/**
 * Determines whether a command invocation represents a full/unscoped test suite runner execution.
 */
export function isFullTestSuiteCommand(argv: readonly string[]): boolean {
  if (!argv || argv.length === 0) return false;
  const joined = argv.join(" ").trim().toLowerCase();

  if (
    joined === "bun test" ||
    joined === "bun run test" ||
    joined === "bun run test:unit" ||
    joined === "bun test:unit" ||
    joined.includes("test --coverage") ||
    joined.includes("run test:unit") ||
    joined === "npm test" ||
    joined === "npm run test" ||
    joined === "npm run test:unit" ||
    joined === "yarn test" ||
    joined === "yarn test:unit" ||
    joined === "pnpm test" ||
    joined === "pnpm test:unit" ||
    joined === "pytest" ||
    joined === "vitest" ||
    joined === "cargo test" ||
    joined === "go test ./..."
  ) {
    return true;
  }

  const isTestRunner =
    (argv[0] === "bun" && argv[1] === "test") ||
    (argv[0] === "bun" &&
      argv[1] === "run" &&
      typeof argv[2] === "string" &&
      argv[2].startsWith("test")) ||
    (argv[0] === "npm" &&
      (argv[1] === "test" ||
        (argv[1] === "run" && typeof argv[2] === "string" && argv[2].startsWith("test")))) ||
    (argv[0] === "yarn" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    (argv[0] === "pnpm" && (argv[1] === "test" || argv[1] === "test:unit")) ||
    argv[0] === "pytest" ||
    argv[0] === "vitest" ||
    argv[0] === "jest";

  if (isTestRunner) {
    const hasSingleTestFile = argv.some(
      (arg) =>
        !arg.startsWith("-") &&
        /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/i.test(arg),
    );
    if (!hasSingleTestFile) {
      return true;
    }
  }

  return false;
}

/**
 * Zero-tolerance boundary invariant names.
 */
export type ZeroToleranceBoundaryInvariant =
  | "0_coordinator_code_writing"
  | "0_orchestrator_task_implementation"
  | "0_unassigned_test_running"
  | "anti_boundary_leak"
  | "spawning_hierarchy"
  | "command_authorization"
  | "validator_hardlock";

/**
 * Concrete violation classifications for role boundary breaches.
 */
export type RoleBoundaryViolationType =
  | "coordinator_code_writing"
  | "orchestrator_direct_implementation"
  | "unassigned_test_running"
  | "anti_boundary_leak"
  | "cross_tier_spawning"
  | "leaf_spawning"
  | "supervisory_task_claim"
  | "forbidden_command_execution"
  | "role_confinement_violation"
  | "validator_hardlock_violation";

/**
 * An action submitted for real-time role-boundary auditing.
 */
export interface RoleBoundaryAction {
  readonly agentId: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly actionType:
    | "tool_use"
    | "command_exec"
    | "task_lease"
    | "task_submit"
    | "test_run"
    | "file_write"
    | "graph_mutation"
    | "spawning";
  readonly toolName?: string | undefined;
  readonly toolCategory?: string | undefined;
  readonly argv?: readonly string[] | undefined;
  readonly taskId?: string | undefined;
  readonly assignedTaskId?: string | undefined;
  readonly assignedTestFiles?: readonly string[] | undefined;
  readonly assignedWriteScope?: readonly string[] | undefined;
  readonly targetFile?: string | undefined;
  readonly targetRole?: string | undefined;
  readonly targetTier?: number | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Real-time role boundary violation finding.
 */
export interface RoleBoundaryViolation {
  readonly id: string;
  readonly invariant: ZeroToleranceBoundaryInvariant;
  readonly violationType: RoleBoundaryViolationType;
  readonly severity: RoleAuditSeverity;
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly observation: string;
  readonly remediation: string;
  readonly action: RoleBoundaryAction;
  readonly timestamp: string;
  readonly defectEntry?: DefectEntry | undefined;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Configuration options for RoleBoundaryWatchdog.
 */
export interface RoleBoundaryWatchdogOptions {
  readonly strictZeroTolerance?: boolean | undefined;
  readonly autoLogDefect?: boolean | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly defectLogger?: ((violation: RoleBoundaryViolation) => DefectEntry | void) | undefined;
  readonly onViolation?: ((violation: RoleBoundaryViolation) => void) | undefined;
  readonly allowedTaskTests?: ReadonlyMap<string, readonly string[]> | undefined;
}

/**
 * Result of batch or state role boundary auditing.
 */
export interface RoleBoundaryAuditResult {
  readonly valid: boolean;
  readonly violations: readonly RoleBoundaryViolation[];
  readonly actionsAuditedCount: number;
  readonly summary: string;
}

/**
 * Hardened Real-Time Role-Boundary Watchdog enforcing zero-tolerance invariants:
 * - 0 Coordinator Code Writing
 * - 0 Orchestrator Task Implementations
 * - 0 Unassigned Test Running
 * - Anti-Boundary Leak enforcement
 * - Spawning Hierarchy compliance
 */
export class RoleBoundaryWatchdog {
  private readonly violations: RoleBoundaryViolation[] = [];
  private readonly options: RoleBoundaryWatchdogOptions;

  constructor(options: RoleBoundaryWatchdogOptions = {}) {
    this.options = options;
  }

  /**
   * Audits a single action in real time against all zero-tolerance boundary invariants.
   */
  public auditAction(action: RoleBoundaryAction): RoleBoundaryViolation | null {
    const tier = action.tier ?? roleToTier(action.role);
    const timestamp = action.timestamp ?? new Date().toISOString();

    // 1. Zero-Tolerance Invariant: 0 coordinator code writing
    const coordViolation = this.checkCoordinatorCodeWriting(action, tier, timestamp);
    if (coordViolation) {
      return this.handleViolation(coordViolation);
    }

    // 2. Zero-Tolerance Invariant: 0 orchestrator task implementation
    const orchViolation = this.checkOrchestratorTaskImplementation(action, tier, timestamp);
    if (orchViolation) {
      return this.handleViolation(orchViolation);
    }

    // 3. Zero-Tolerance Invariant: 0 unassigned test running
    const testViolation = this.checkUnassignedTestRunning(action, tier, timestamp);
    if (testViolation) {
      return this.handleViolation(testViolation);
    }

    // 4. Anti-Boundary Leak checks for Validators and Critics
    const antiLeakViolation = this.checkAntiBoundaryLeakAction(action, tier, timestamp);
    if (antiLeakViolation) {
      return this.handleViolation(antiLeakViolation);
    }

    // 5. Cognitive Validator Hard-Lock Interlock
    const hardlockViolation = this.checkCognitiveValidatorHardlockAction(action, tier, timestamp);
    if (hardlockViolation) {
      return this.handleViolation(hardlockViolation);
    }

    // 6. Spawning hierarchy checks
    const spawningViolation = this.checkSpawningHierarchyAction(action, tier, timestamp);
    if (spawningViolation) {
      return this.handleViolation(spawningViolation);
    }

    // 7. Forbidden commands checks
    const cmdViolation = this.checkForbiddenCommandsAction(action, tier, timestamp);
    if (cmdViolation) {
      return this.handleViolation(cmdViolation);
    }

    return null;
  }

  /**
   * Audits a batch of actions.
   */
  public auditActions(actions: readonly RoleBoundaryAction[]): RoleBoundaryAuditResult {
    const foundViolations: RoleBoundaryViolation[] = [];

    for (const action of actions) {
      const v = this.auditAction(action);
      if (v) {
        foundViolations.push(v);
      }
    }

    const valid = foundViolations.length === 0;
    const summary = valid
      ? `Clean: 0 role boundary violations across ${actions.length} audited actions.`
      : `Action required: ${foundViolations.length} role boundary violations detected across ${actions.length} audited actions.`;

    return {
      valid,
      violations: foundViolations,
      actionsAuditedCount: actions.length,
      summary,
    };
  }

  /**
   * Audits an entire capsule state snapshot (agents, commands, tasks, events).
   */
  public auditState(state: unknown): RoleBoundaryAuditResult {
    if (!isJsonObject(state)) {
      return {
        valid: true,
        violations: [],
        actionsAuditedCount: 0,
        summary: "Clean: 0 actions extracted from non-object state.",
      };
    }

    const actions: RoleBoundaryAction[] = [];
    const roleMap = new Map<string, string>();

    // 1. Extract agent roles and tool uses
    const rawAgents = Array.isArray(state.agents)
      ? state.agents
      : isJsonObject(state.agents)
        ? Object.values(state.agents)
        : [];

    for (const agent of rawAgents) {
      if (!isJsonObject(agent)) continue;
      const agentId = typeof agent.id === "string" ? agent.id : "";
      const role = typeof agent.role === "string" ? agent.role : "";
      if (agentId && role) {
        roleMap.set(agentId, role);
      }

      const parentAgentId = typeof agent.parent_agent_id === "string" ? agent.parent_agent_id : "";
      if (parentAgentId && role) {
        const parentRole = roleMap.get(parentAgentId) ?? "orchestrator";
        actions.push({
          agentId: parentAgentId,
          role: parentRole,
          actionType: "spawning",
          targetRole: role,
          targetTier: roleToTier(role),
        });
      }

      const toolsUsed = Array.isArray(agent.tools_used) ? agent.tools_used : [];
      for (const tool of toolsUsed) {
        if (!isJsonObject(tool)) continue;
        const toolName = typeof tool.name === "string" ? tool.name : "";
        const toolCategory = typeof tool.category === "string" ? tool.category : undefined;
        if (toolName) {
          actions.push({
            agentId,
            role,
            actionType: "tool_use",
            toolName,
            toolCategory,
          });
        }
      }
    }

    // 2. Extract commands
    const rawCommands = isJsonObject(state.commands) ? Object.values(state.commands) : [];
    for (const cmd of rawCommands) {
      if (!isJsonObject(cmd)) continue;
      const actor = typeof cmd.actor === "string" ? cmd.actor : "";
      const role = roleMap.get(actor) ?? (actor ? actor : "unknown");
      const argv = Array.isArray(cmd.argv)
        ? cmd.argv.filter((a): a is string => typeof a === "string")
        : [];
      const taskId = typeof cmd.task_id === "string" ? cmd.task_id : undefined;
      const tool = typeof cmd.tool === "string" ? cmd.tool : undefined;
      const toolCategory = typeof cmd.tool_category === "string" ? cmd.tool_category : undefined;

      actions.push({
        agentId: actor,
        role,
        actionType: "command_exec",
        argv,
        taskId,
        toolName: tool,
        toolCategory,
      });
    }

    // 3. Extract tasks and leases
    const rawTasks = isJsonObject(state.tasks) ? Object.values(state.tasks) : [];
    for (const task of rawTasks) {
      if (!isJsonObject(task)) continue;
      const taskId = typeof task.id === "string" ? task.id : "";
      const lease = isJsonObject(task.lease) ? task.lease : undefined;
      if (lease) {
        const leaseAgentId = typeof lease.agent_id === "string" ? lease.agent_id : "";
        const leaseRole =
          typeof lease.role === "string"
            ? lease.role
            : (roleMap.get(leaseAgentId) ?? "implementer");

        actions.push({
          agentId: leaseAgentId,
          role: leaseRole,
          actionType: "task_lease",
          taskId,
        });
      }
    }

    return this.auditActions(actions);
  }

  /**
   * Returns all recorded boundary violations.
   */
  public getViolations(): readonly RoleBoundaryViolation[] {
    return [...this.violations];
  }

  /**
   * Clears accumulated violations.
   */
  public clearViolations(): void {
    this.violations.length = 0;
  }

  /**
   * Formats a clean markdown report of detected boundary violations.
   */
  public formatViolationReport(options: { readonly compact?: boolean | undefined } = {}): string {
    const lines: string[] = [];
    const status = this.violations.length === 0 ? "🟢 ZERO VIOLATIONS" : "🔴 ACTION REQUIRED";
    lines.push("### 🛡️ Role-Boundary Watchdog Report");
    lines.push(`- **Status**: ${status}`);
    lines.push(`- **Total Violations**: ${this.violations.length}`);
    lines.push("");

    if (this.violations.length === 0) {
      lines.push(
        "✅ **Zero role boundary violations detected.** Real-time invariants (0 coordinator code writing, 0 orchestrator task implementations, 0 unassigned test running) are 100% preserved.",
      );
      return lines.join("\n").trim();
    }

    if (!options.compact) {
      lines.push("#### ⚠️ Violation Details");
      for (const v of this.violations) {
        lines.push(`##### [${v.severity}] ${v.title} (\`${v.id}\`)`);
        lines.push(`- **Agent**: \`${v.agentId}\` (Tier ${v.tier} \`${v.role}\`)`);
        lines.push(`- **Invariant**: \`${v.invariant}\` | **Type**: \`${v.violationType}\``);
        lines.push(`- **Observation**: ${v.observation}`);
        lines.push(`- **Remediation**: ${v.remediation}`);
        lines.push("");
      }
    }

    return lines.join("\n").trim();
  }

  // --- Private Verification Checkers ---

  private checkCoordinatorCodeWriting(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (tier !== 2 && !isCoordinatorRole(action.role)) {
      return null;
    }

    const isEditTool =
      (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
      action.toolCategory === "file-edit";

    const isDirectWrite = action.actionType === "file_write" || action.targetFile !== undefined;

    const hasEditArg = (action.argv ?? []).some(
      (arg) => CODE_EDIT_TOOLS.has(arg) || arg.startsWith("write:") || arg.startsWith("edit:"),
    );

    const isTaskLease = action.actionType === "task_lease";

    if (isEditTool || isDirectWrite || hasEditArg || isTaskLease) {
      const toolDetail = action.toolName ? `tool '${action.toolName}'` : "code modification";
      return {
        id: `VIOL-COORD-WRITE-${action.agentId}-${Date.now()}`,
        invariant: "0_coordinator_code_writing",
        violationType: "coordinator_code_writing",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 2,
        title: "Zero-Tolerance Violation: Coordinator Code Writing",
        observation: `Zero-Tolerance Invariant Breached (0 Coordinator Code Writing): Tier 2 Coordinator '${action.agentId}' attempted ${isTaskLease ? "to claim implementation task lease" : `${toolDetail} or direct file modification`}.`,
        remediation:
          "Coordinators must never write code, edit files, or hold implementation leases directly. Delegate all task implementation to Tier 3 Implementers via host subagent dispatch.",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          toolName: action.toolName,
          toolCategory: action.toolCategory,
          targetFile: action.targetFile,
          taskId: action.taskId,
          argv: action.argv,
        },
      };
    }

    return null;
  }

  private checkOrchestratorTaskImplementation(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (tier !== 1 && !isOrchestratorRole(action.role)) {
      return null;
    }

    const isEditTool =
      (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
      action.toolCategory === "file-edit" ||
      action.actionType === "file_write";

    const isTaskLeaseOrSubmit =
      action.actionType === "task_lease" || action.actionType === "task_submit";

    const hasDirectTaskId =
      action.actionType === "command_exec" &&
      Boolean(action.taskId) &&
      !action.argv?.some((a) => a.startsWith("mind:"));

    const hasGraphMutation =
      action.actionType === "graph_mutation" ||
      (action.argv ?? []).some((arg) => GRAPH_MUTATION_COMMANDS.has(arg));

    const hasClaimArg = (action.argv ?? []).some(
      (arg) => arg === "task:claim" || arg === "task:submit",
    );

    if (isEditTool || isTaskLeaseOrSubmit || hasDirectTaskId || hasGraphMutation || hasClaimArg) {
      return {
        id: `VIOL-ORCH-IMPL-${action.agentId}-${Date.now()}`,
        invariant: "0_orchestrator_task_implementation",
        violationType: "orchestrator_direct_implementation",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 1,
        title: "Zero-Tolerance Violation: Orchestrator Task Implementation",
        observation: `Zero-Tolerance Invariant Breached (0 Orchestrator Task Implementation): Tier 1 Orchestrator '${action.agentId}' attempted direct implementation work, task execution, or task-graph mutation.`,
        remediation:
          "Orchestrators must only orchestrate via CLI commands and manage rounds. All implementation tasks and graph mutations must be delegated to Tier 2 Coordinators and Tier 3 Implementers.",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          taskId: action.taskId,
          argv: action.argv,
          toolName: action.toolName,
        },
      };
    }

    return null;
  }

  private checkUnassignedTestRunning(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    const isTestIntent =
      action.actionType === "test_run" ||
      (action.argv &&
        (isFullTestSuiteCommand(action.argv) ||
          action.argv.some(
            (arg) =>
              arg === "test" ||
              arg === "test:unit" ||
              arg.includes(".test.") ||
              arg.includes(".spec."),
          )));

    if (!isTestIntent) {
      return null;
    }

    const argv = action.argv ?? [];

    // A. Supervisory Agents (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) running tests
    if (
      tier < 3 ||
      isMindRole(action.role) ||
      isOrchestratorRole(action.role) ||
      isCoordinatorRole(action.role)
    ) {
      return {
        id: `VIOL-TEST-SUPERVISOR-${action.agentId}-${Date.now()}`,
        invariant: "0_unassigned_test_running",
        violationType: "unassigned_test_running",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Zero-Tolerance Violation: Supervisory Role Test Execution",
        observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Supervisory agent '${action.agentId}' (Tier ${tier} ${action.role}) executed test command '${argv.join(" ")}'. Supervisory agents must not run tests.`,
        remediation:
          "Supervisors must coordinate task evidence without running test commands directly. Full test suites belong exclusively to Completeness Critics, and scoped tests belong to assigned Tier 3 Implementers.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
          tier,
        },
      };
    }

    // B. Tier 3 Implementers running full test suites
    if (isImplementerRole(action.role) && isFullTestSuiteCommand(argv)) {
      return {
        id: `VIOL-TEST-FULLSUITE-${action.agentId}-${Date.now()}`,
        invariant: "0_unassigned_test_running",
        violationType: "unassigned_test_running",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Zero-Tolerance Violation: Implementer Full Test Suite Execution",
        observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Implementer '${action.agentId}' executed broad test suite command '${argv.join(" ")}'. Implementers may only run file-scoped unit tests.`,
        remediation:
          "Implementers must only execute targeted single-file unit tests matching their assigned write scope (e.g. `bun test tests/unit/mind/specific.test.ts`). Running full test suites is strictly reserved for Completeness Critics.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    // C. Tier 3 Implementers running unassigned test files
    if (
      isImplementerRole(action.role) &&
      action.assignedTestFiles &&
      action.assignedTestFiles.length > 0
    ) {
      const testArgs = argv.filter(
        (arg) =>
          !arg.startsWith("-") &&
          /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/i.test(arg),
      );

      for (const targetTest of testArgs) {
        const isAssigned = action.assignedTestFiles.some(
          (assigned) =>
            targetTest.includes(assigned) ||
            assigned.includes(targetTest) ||
            targetTest.endsWith(assigned) ||
            assigned.endsWith(targetTest),
        );

        if (!isAssigned) {
          return {
            id: `VIOL-TEST-UNASSIGNED-${action.agentId}-${Date.now()}`,
            invariant: "0_unassigned_test_running",
            violationType: "unassigned_test_running",
            severity: "HIGH",
            agentId: action.agentId,
            role: action.role,
            tier: 3,
            title: "Zero-Tolerance Violation: Implementer Unassigned Test Execution",
            observation: `Zero-Tolerance Invariant Breached (0 Unassigned Test Running): Implementer '${action.agentId}' ran unassigned test '${targetTest}'. Assigned tests: [${action.assignedTestFiles.join(", ")}].`,
            remediation:
              "Implementers may only execute test files specifically within their assigned write scope and task contract.",
            action,
            timestamp,
            evidence: {
              targetTest,
              assignedTestFiles: [...action.assignedTestFiles],
            },
          };
        }
      }
    }

    return null;
  }

  private checkAntiBoundaryLeakAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    // 1. Validator write scope leaks
    if (isValidatorRole(action.role)) {
      const isWrite =
        action.actionType === "file_write" ||
        action.actionType === "task_lease" ||
        (action.toolName && CODE_EDIT_TOOLS.has(action.toolName)) ||
        action.toolCategory === "file-edit" ||
        action.targetFile !== undefined;

      if (isWrite) {
        return {
          id: `VIOL-LEAK-VALWRITE-${action.agentId}-${Date.now()}`,
          invariant: "anti_boundary_leak",
          violationType: "anti_boundary_leak",
          severity: "CRITICAL",
          agentId: action.agentId,
          role: action.role,
          tier: 3,
          title: "Anti-Boundary-Leak: Validator Write Attempt",
          observation: `Anti-Boundary-Leak Violation: Validator '${action.agentId}' attempted code modification or task lease acquisition. Validators must be strictly read-only.`,
          remediation:
            "Enforce Anti-Boundary-Leak invariant: Validators and Critics are strictly forbidden from modifying files or claiming write leases.",
          action,
          timestamp,
          evidence: {
            actionType: action.actionType,
            toolName: action.toolName,
            targetFile: action.targetFile,
          },
        };
      }
    }

    // 2. Implementer self-grading or validation command execution
    if (isImplementerRole(action.role)) {
      const valCmd = (action.argv ?? []).find((arg) => VALIDATION_COMMANDS.has(arg));
      if (valCmd) {
        return {
          id: `VIOL-LEAK-IMPLVAL-${action.agentId}-${Date.now()}`,
          invariant: "anti_boundary_leak",
          violationType: "anti_boundary_leak",
          severity: "CRITICAL",
          agentId: action.agentId,
          role: action.role,
          tier: 3,
          title: "Anti-Boundary-Leak: Implementer Self-Grading Command",
          observation: `Anti-Boundary-Leak Violation: Implementer '${action.agentId}' executed validation command '${valCmd}'. Implementers cannot evaluate or grade tasks.`,
          remediation:
            "Validation commands are exclusively reserved for independent Tier 3 Validators.",
          action,
          timestamp,
          evidence: {
            validationCommand: valCmd,
            argv: action.argv,
          },
        };
      }
    }

    return null;
  }

  private checkCognitiveValidatorHardlockAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (!isCognitiveValidatorRole(action.role) || isMechanicValidatorRole(action.role)) {
      return null;
    }

    const argv = action.argv ?? [];
    const isRunExec = argv.includes("run:exec");
    const hasExecutionCategory =
      action.toolCategory !== undefined &&
      PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(action.toolCategory.toLowerCase().trim());
    const isProhibitedTool =
      action.toolName !== undefined &&
      (PROHIBITED_COGNITIVE_TOOLS.has(action.toolName.toLowerCase().trim()) ||
        PROHIBITED_COGNITIVE_TOOL_CATEGORIES.has(action.toolName.toLowerCase().trim()));
    const isTestRunAction = action.actionType === "test_run";
    const hasTestArg = argv.some((a) => {
      const lower = a.toLowerCase();
      return (
        lower === "run:exec" ||
        lower === "test" ||
        lower.startsWith("test:") ||
        lower.includes(".test.") ||
        lower.includes(".spec.") ||
        lower === "pytest" ||
        lower === "vitest" ||
        lower === "jest" ||
        lower === "cargo" ||
        lower === "npm" ||
        lower === "yarn" ||
        lower === "pnpm"
      );
    });

    if (isRunExec || hasExecutionCategory || isProhibitedTool || isTestRunAction || hasTestArg) {
      const detail = action.toolName ?? (argv.length > 0 ? argv.join(" ") : action.actionType);
      return {
        id: `VIOL-HARDLOCK-VAL-${action.agentId}-${Date.now()}`,
        invariant: "validator_hardlock",
        violationType: "validator_hardlock_violation",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Cognitive Validator Hard-Lock Interlock Violation",
        observation: `Cognitive Validator Hard-Lock Violation: Cognitive Validator/Critic '${action.agentId}' (${action.role}) attempted execution/test action '${detail}'. Cognitive Validators and Critics are strictly locked from running bash, shell commands, test runners, build tools, or package managers.`,
        remediation:
          "Cognitive Validators must evaluate deliverables strictly via read-only inspection and artifact review. Test execution authority belongs exclusively to Mechanic Validators (mechanic-validator / ui-mechanic-validator).",
        action,
        timestamp,
        evidence: {
          actionType: action.actionType,
          argv: action.argv,
          toolName: action.toolName,
          toolCategory: action.toolCategory,
        },
      };
    }

    return null;
  }

  private checkSpawningHierarchyAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    if (action.actionType !== "spawning") {
      return null;
    }

    // Tier 3 Leaf spawning violation
    if (tier === 3 || isImplementerRole(action.role) || isValidatorRole(action.role)) {
      return {
        id: `VIOL-SPAWN-LEAF-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "leaf_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 3,
        title: "Hierarchy Violation: Tier 3 Leaf Spawning Subagent",
        observation: `Tier 3 Leaf agent '${action.agentId}' (${action.role}) attempted to spawn child subagent '${action.targetRole ?? "unknown"}'. Tier 3 roles are leaf execution workers and cannot spawn subagents.`,
        remediation:
          "Clear spawns for Tier 3 workers. Subagent dispatch is strictly reserved for supervisory tiers.",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
          targetTier: action.targetTier,
        },
      };
    }

    // Tier 0 Mind spawning non-orchestrator
    if (tier === 0 && action.targetRole && !isOrchestratorRole(action.targetRole)) {
      return {
        id: `VIOL-SPAWN-TIER0-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 0,
        title: "Hierarchy Violation: Tier 0 Cross-Tier Spawning",
        observation: `Tier 0 Mind '${action.agentId}' directly dispatched non-orchestrator agent '${action.targetRole}'. Mind may only dispatch Tier 1 Orchestrators.`,
        remediation:
          "Enforce hierarchical spawning: Mind (Tier 0) -> Orchestrator (Tier 1) -> Coordinator (Tier 2) -> Implementer/Validator (Tier 3).",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
        },
      };
    }

    // Tier 1 Orchestrator spawning non-coordinator
    if (tier === 1 && action.targetRole && !isCoordinatorRole(action.targetRole)) {
      return {
        id: `VIOL-SPAWN-TIER1-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 1,
        title: "Hierarchy Violation: Tier 1 Cross-Tier Spawning",
        observation: `Tier 1 Orchestrator '${action.agentId}' directly dispatched non-coordinator agent '${action.targetRole}'. Orchestrators may only dispatch Tier 2 Coordinators.`,
        remediation:
          "Orchestrators cannot directly spawn Tier 3 workers. Orchestrator must dispatch Tier 2 Coordinator.",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
        },
      };
    }

    // Tier 2 Coordinator spawning non-tier-3
    if (
      tier === 2 &&
      action.targetRole &&
      (isMindRole(action.targetRole) ||
        isOrchestratorRole(action.targetRole) ||
        isCoordinatorRole(action.targetRole) ||
        (action.targetTier !== undefined && action.targetTier < 3))
    ) {
      return {
        id: `VIOL-SPAWN-TIER2-${action.agentId}-${Date.now()}`,
        invariant: "spawning_hierarchy",
        violationType: "cross_tier_spawning",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier: 2,
        title: "Hierarchy Violation: Tier 2 Cross-Tier Spawning",
        observation: `Tier 2 Coordinator '${action.agentId}' attempted to dispatch non-Tier-3 agent '${action.targetRole}'. Coordinators may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers).`,
        remediation:
          "Coordinators may only spawn Tier 3 task workers (Implementer, Validator, Critic, Repairer).",
        action,
        timestamp,
        evidence: {
          targetRole: action.targetRole,
          targetTier: action.targetTier,
        },
      };
    }

    return null;
  }

  private checkForbiddenCommandsAction(
    action: RoleBoundaryAction,
    tier: number,
    timestamp: string,
  ): RoleBoundaryViolation | null {
    const argv = action.argv ?? [];

    if (argv.includes("orchestrator:run")) {
      return {
        id: `VIOL-CMD-ORCHRUN-${action.agentId}-${Date.now()}`,
        invariant: "command_authorization",
        violationType: "forbidden_command_execution",
        severity: "CRITICAL",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Forbidden Command 'orchestrator:run' Execution Attempt",
        observation: `Agent '${action.agentId}' (${action.role}) attempted to execute strictly forbidden command 'orchestrator:run'.`,
        remediation: "Remove all invocations of 'orchestrator:run' across all tiers.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    if (tier < 3 && argv.includes("task:claim")) {
      return {
        id: `VIOL-CMD-SUPERCLAIM-${action.agentId}-${Date.now()}`,
        invariant: "command_authorization",
        violationType: "supervisory_task_claim",
        severity: "HIGH",
        agentId: action.agentId,
        role: action.role,
        tier,
        title: "Supervisory Task Claim Execution Attempt",
        observation: `Supervisory agent '${action.agentId}' (Tier ${tier} ${action.role}) attempted 'task:claim'. Supervisors must delegate task execution, not claim them.`,
        remediation:
          "Task claim commands are strictly reserved for Tier 3 Implementers holding active task leases.",
        action,
        timestamp,
        evidence: {
          argv: [...argv],
        },
      };
    }

    return null;
  }

  private handleViolation(violation: RoleBoundaryViolation): RoleBoundaryViolation {
    let defectEntry: DefectEntry | undefined = undefined;

    if (this.options.autoLogDefect) {
      if (this.options.defectLogger) {
        const res = this.options.defectLogger(violation);
        if (res) defectEntry = res;
      } else {
        defectEntry = logBoundaryViolationDefect(
          {
            agent_id: violation.agentId,
            role: violation.role,
            tier: violation.tier,
            violation_type: violation.violationType,
            invariant: violation.invariant,
            severity: violation.severity.toLowerCase(),
            observation: violation.observation,
            remediation: violation.remediation,
            evidence: violation.evidence,
          },
          {
            capsuleRoot: this.options.capsuleRoot,
          },
        );
      }
    }

    const completeViolation: RoleBoundaryViolation = {
      ...violation,
      ...(defectEntry !== undefined ? { defectEntry } : {}),
    };

    this.violations.push(completeViolation);
    this.options.onViolation?.(completeViolation);

    if (this.options.strictZeroTolerance) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", completeViolation.observation);
    }

    return completeViolation;
  }
}

/**
 * Factory function to create a new RoleBoundaryWatchdog.
 */
export function createRoleBoundaryWatchdog(
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryWatchdog {
  return new RoleBoundaryWatchdog(options);
}

/**
 * Audits a single role boundary action.
 */
export function verifyRoleBoundaryAction(
  action: RoleBoundaryAction,
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryViolation | null {
  const watchdog = new RoleBoundaryWatchdog(options);
  return watchdog.auditAction(action);
}

/**
 * Audits a list of role boundary actions.
 */
export function auditRoleBoundaryActions(
  actions: readonly RoleBoundaryAction[],
  options: RoleBoundaryWatchdogOptions = {},
): RoleBoundaryAuditResult {
  const watchdog = new RoleBoundaryWatchdog(options);
  return watchdog.auditActions(actions);
}

export interface ParentChildSupervisionResult {
  readonly valid: boolean;
  readonly parentRole: string;
  readonly childRole: string;
  readonly parentTier: number;
  readonly childTier: number;
  readonly reason?: string;
}

export function validateParentChildSupervision(
  parentRole: string,
  childRole: string,
): ParentChildSupervisionResult {
  const pTier = roleToTier(parentRole);
  const cTier = roleToTier(childRole);

  // Tier 0 Mind -> Tier 1 Orchestrator only
  if (pTier === 0) {
    if (cTier === 1 && isOrchestratorRole(childRole)) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 0 Mind (${parentRole}) may only dispatch Tier 1 Orchestrators. Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 1 Orchestrator -> Tier 2 Coordinator only
  if (pTier === 1) {
    if (cTier === 2 && isCoordinatorRole(childRole)) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 1 Orchestrator (${parentRole}) may only dispatch Tier 2 Coordinators. Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 2 Coordinator -> Tier 3 workers only
  if (pTier === 2) {
    if (
      cTier === 3 &&
      !isMindRole(childRole) &&
      !isOrchestratorRole(childRole) &&
      !isCoordinatorRole(childRole)
    ) {
      return { valid: true, parentRole, childRole, parentTier: pTier, childTier: cTier };
    }
    return {
      valid: false,
      parentRole,
      childRole,
      parentTier: pTier,
      childTier: cTier,
      reason: `Tier 2 Coordinator (${parentRole}) may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers). Disagreeing child role '${childRole}' (Tier ${cTier}) violates hierarchical parent-child boundary.`,
    };
  }

  // Tier 3 Leaf workers -> cannot spawn children
  return {
    valid: false,
    parentRole,
    childRole,
    parentTier: pTier,
    childTier: cTier,
    reason: `Tier 3 worker (${parentRole}) is a leaf execution agent and cannot dispatch child agents ('${childRole}').`,
  };
}

export function assertParentChildBoundary(
  parentRole: string,
  childRole: string,
  parentAgentId?: string,
  childAgentId?: string,
): void {
  const result = validateParentChildSupervision(parentRole, childRole);
  if (!result.valid) {
    const parentDisplay = parentAgentId ? `'${parentAgentId}' (${parentRole})` : `'${parentRole}'`;
    const childDisplay = childAgentId ? `'${childAgentId}' (${childRole})` : `'${childRole}'`;
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Active Hierarchical Parent-Child Boundary Violation: Supervisor ${parentDisplay} cannot dispatch subagent ${childDisplay}. ${result.reason}`,
    );
  }
}

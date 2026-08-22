import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
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

  // 2. Anti-Boundary-Leak Enforcement for Validators & Critics
  if (strictAntiLeak && (spec.archetype === "tier_3_validator" || spec.archetype === "tier_3_critic")) {
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
  }

  // 3. Spawning Hierarchy Validation
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

    if (spec.tier === 0 && spec.spawns.some((s) => s !== "orchestrator")) {
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

    if (spec.tier === 1 && spec.spawns.some((s) => s !== "coordinator")) {
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
    spec.invariants.some((i) => i.toLowerCase().includes("zero-any") || i.toLowerCase().includes("zero any"));

  if (spec.tier === 3 && spec.archetype === "tier_3_implementer" && !hasZeroAnyPillar) {
    findings.push({
      id: `FIND-PILLAR-ZEROANY-${spec.name}`,
      roleName: spec.name,
      tier: spec.tier,
      category: "cognitive_pillars",
      severity: "LOW",
      title: "Missing Explicit Zero-Any TypeScript Pillar",
      description: `Implementer role '${spec.name}' does not explicitly cite the Zero-Any TypeScript discipline.`,
      recommendation: "Include 'Strict Zero-Any & Zero-Suppression TypeScript Discipline' in cognitive pillars.",
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
    lines.push("✅ **Zero role audit findings.** All registered personas adhere strictly to 4-Tier boundaries, Anti-Boundary-Leak invariants, and Zero-Any type discipline.");
    return lines.join("\n").trim();
  }

  if (!options.compact) {
    lines.push("#### ⚠️ Detailed Findings List");
    for (const f of report.findings) {
      lines.push(`##### [${f.severity}] ${f.title} (\`${f.id}\`)`);
      lines.push(`- **Role**: \`${f.roleName}\` (Tier ${f.tier}) | **Category**: \`${f.category}\``);
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
export function formatNonDuplicatePersonaSummary(
  result: NonDuplicateRoleSynthesisResult,
): string {
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

import { existsSync, readdirSync } from "node:fs";
import { basename, extname } from "node:path";
import { normalizeRoleName } from "../authority/manifest-parser.ts";
import { HarnessError } from "../core/errors/index.ts";
import { roleToTier } from "./naming.ts";
import type {
  AgentTriadOptions,
  TriadValidationResult,
  TriadAuditReport,
  AgentTriadBundle,
} from "./agent-triad-types.ts";
import { resolveWorkspacePaths } from "./agent-triad-paths.ts";
import { loadAgentIdentity, loadAgentRoleDefinition } from "./agent-triad-loaders.ts";
import { loadAgentReferenceDocs, findRelevantReferencesForRole } from "./agent-triad-references.ts";

export function validateAgentTriad(
  roleInput: string,
  options?: AgentTriadOptions,
): TriadValidationResult {
  const normRole = normalizeRoleName(roleInput);
  const issues: string[] = [];
  const warnings: string[] = [];

  const identity = loadAgentIdentity(normRole, options);
  const hasIdentity = Boolean(identity.filePath && existsSync(identity.filePath));
  if (!hasIdentity) {
    issues.push(`Missing agent identity manifest in agents/ for role '${normRole}'`);
  }

  const definition = loadAgentRoleDefinition(normRole, options);
  const hasDefinition = Boolean(definition.filePath && existsSync(definition.filePath));
  if (!hasDefinition) {
    issues.push(`Missing agent role definition in agents/ for role '${normRole}'`);
  }

  let tierConsistent = true;
  if (hasIdentity && hasDefinition) {
    if (identity.tier !== definition.tier) {
      tierConsistent = false;
      issues.push(
        `Tier mismatch: manifest specifies Tier ${identity.tier}, but role contract specifies Tier ${definition.tier}`,
      );
    }
  }

  let roleContractRefConsistent = true;
  if (hasIdentity && identity.protocol?.role_contract) {
    const ref = identity.protocol.role_contract;
    const cleanRef = basename(ref, extname(ref));
    const isKnownMapping =
      (normRole === "ui-mechanic-validator" && cleanRef === "mechanic-validator") ||
      (normRole === "ui-validator" &&
        (cleanRef === "validator-ui-design" || cleanRef === "validator")) ||
      (normRole === "mechanic-validator" && cleanRef === "mechanic-validator") ||
      (normRole.startsWith("validator-") && (cleanRef === normRole || cleanRef === "validator"));
    if (cleanRef !== normRole && cleanRef !== identity.name && !isKnownMapping) {
      roleContractRefConsistent = false;
      warnings.push(
        `Manifest protocol.role_contract '${ref}' points to a different role name than '${normRole}'`,
      );
    }
  }

  const allReferences = loadAgentReferenceDocs(options);
  const relevantReferences = findRelevantReferencesForRole(
    normRole,
    allReferences,
    identity,
    definition,
  );
  const hasReferences = relevantReferences.length > 0;
  if (!hasReferences) {
    warnings.push(
      `No associated reference documentation found for role '${normRole}' in references/`,
    );
  }

  const effectiveTier = hasDefinition
    ? definition.tier
    : hasIdentity
      ? identity.tier
      : roleToTier(normRole);
  const valid = issues.length === 0;

  return {
    valid,
    role: normRole,
    tier: effectiveTier,
    hasIdentity,
    hasDefinition,
    hasReferences,
    referenceCount: relevantReferences.length,
    identityPath: identity.filePath,
    definitionPath: definition.filePath,
    referencePaths: relevantReferences.map((r) => r.filePath),
    tierConsistent,
    roleContractRefConsistent,
    issues,
    warnings,
  };
}

export function auditAgentTriadWorkspace(options?: AgentTriadOptions): TriadAuditReport {
  const { skillRoot, agentsDir, referencesDir } = resolveWorkspacePaths(options);
  const issues: string[] = [];

  const manifestRoles = new Set<string>();
  if (existsSync(agentsDir)) {
    try {
      const files = readdirSync(agentsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const role = normalizeRoleName(basename(file, extname(file)));
          manifestRoles.add(role);
        }
      }
    } catch {
      issues.push(`Failed to read agents directory: ${agentsDir}`);
    }
  } else {
    issues.push(`Agents directory does not exist: ${agentsDir}`);
  }

  const allReferences = loadAgentReferenceDocs(options);
  const allRoles = manifestRoles;

  const triads: TriadValidationResult[] = [];
  const orphanedManifests: string[] = [];
  const orphanedContracts: string[] = [];

  let completeCount = 0;
  for (const r of Array.from(allRoles).sort()) {
    const val = validateAgentTriad(r, options);
    triads.push(val);
    if (val.valid && val.hasIdentity && val.hasDefinition) {
      completeCount++;
    } else {
      for (const issue of val.issues) {
        if (!issues.includes(issue)) {
          issues.push(`[${r}] ${issue}`);
        }
      }
    }
  }

  const allReferencedDocIds = new Set<string>();
  for (const triad of triads) {
    for (const path of triad.referencePaths) {
      allReferencedDocIds.add(basename(path, extname(path)));
    }
  }

  const unreferencedReferences: string[] = [];
  for (const ref of allReferences) {
    if (!allReferencedDocIds.has(ref.id)) {
      unreferencedReferences.push(ref.id);
    }
  }

  const missingReferences: string[] = [];
  if (allReferences.length === 0) {
    missingReferences.push(`No reference documentation found in ${referencesDir}`);
  }

  const incompleteCount = allRoles.size - completeCount;
  const healthy = issues.length === 0 && incompleteCount === 0;

  const summary = healthy
    ? `Agent Triad Workspace Audit Healthy: ${completeCount}/${allRoles.size} complete unified agent manifests verified in agents/ with references/.`
    : `Agent Triad Workspace Audit Found Inconsistencies: ${completeCount}/${allRoles.size} complete triads, ${issues.length} total issues.`;

  return {
    timestamp: new Date().toISOString(),
    skillRoot,
    totalRoles: allRoles.size,
    completeTriads: completeCount,
    incompleteTriads: incompleteCount,
    healthy,
    triads,
    orphanedManifests: orphanedManifests.sort(),
    orphanedContracts: orphanedContracts.sort(),
    unreferencedReferences: unreferencedReferences.sort(),
    missingReferences,
    issues,
    summary,
  };
}

export function synthesizeTriadManifest(
  roleInput: string,
  options?: AgentTriadOptions,
): AgentTriadBundle {
  const normRole = normalizeRoleName(roleInput);
  const validation = validateAgentTriad(normRole, options);

  if (options?.strict && !validation.valid) {
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to synthesize triad bundle for role '${normRole}': ${validation.issues.join("; ")}`,
      validation.issues,
    );
  }

  const identity = loadAgentIdentity(normRole, options);
  const definition = loadAgentRoleDefinition(normRole, options);
  const allReferences = loadAgentReferenceDocs(options);
  const references = findRelevantReferencesForRole(normRole, allReferences, identity, definition);

  const isComplete =
    validation.hasIdentity && validation.hasDefinition && validation.tierConsistent;
  const validationIssues = validation.issues.length > 0 ? validation.issues : undefined;

  return {
    role: normRole,
    tier: validation.tier,
    identity,
    definition,
    references,
    isComplete,
    validationIssues,
  };
}

export function assertTriadIntegrity(
  roleOrBundle: string | AgentTriadBundle,
  options?: AgentTriadOptions,
): void {
  if (typeof roleOrBundle === "string") {
    const role = roleOrBundle;
    const validation = validateAgentTriad(role, options);
    if (!validation.valid) {
      throw new HarnessError(
        "INVALID_STATE",
        `Triad integrity violation for role '${role}': ${validation.issues.join(", ")}`,
        validation.issues,
      );
    }
    if (!validation.hasIdentity || !validation.hasDefinition) {
      throw new HarnessError(
        "INVALID_STATE",
        `Triad integrity incomplete for role '${role}': identity=${validation.hasIdentity}, definition=${validation.hasDefinition}`,
        validation.issues,
      );
    }
    if (!validation.tierConsistent) {
      throw new HarnessError(
        "INTEGRITY",
        `Triad tier inconsistency detected for role '${role}'`,
        validation.issues,
      );
    }
    return;
  }

  const bundle = roleOrBundle;
  if (!bundle.isComplete) {
    const issues = bundle.validationIssues ?? ["Bundle marked incomplete"];
    throw new HarnessError(
      "INVALID_STATE",
      `Triad bundle integrity check failed for role '${bundle.role}': ${issues.join(", ")}`,
      issues,
    );
  }

  if (bundle.identity.tier !== bundle.definition.tier) {
    throw new HarnessError(
      "INTEGRITY",
      `Triad bundle tier mismatch for role '${bundle.role}': identity=${bundle.identity.tier}, definition=${bundle.definition.tier}`,
    );
  }

  if (bundle.references.length === 0) {
    if (options?.strict) {
      throw new HarnessError(
        "INVALID_STATE",
        `Triad bundle for role '${bundle.role}' contains no reference documentation`,
      );
    }
  }
}

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";
import {
  findSkillRoot,
  normalizeRoleName,
  parseAgentManifest,
  parseRoleContract,
  type AgentManifest,
  type AgentManifestInterface,
  type AgentManifestProtocol,
  type AgentToolsConfig,
  type RoleContract,
  type RoleContractFrontmatter,
} from "../authority/manifest-parser.ts";
import { roleToTier } from "./naming.ts";

// ---------------------------------------------------------------------------
// Triad Architecture Interfaces
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  readonly name: string;
  readonly role: string;
  readonly tier: number;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly provider?: readonly string[] | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly protocol?: AgentManifestProtocol | undefined;
  readonly milestoneNotifications?: Readonly<Record<string, boolean>> | undefined;
  readonly invariants?: Readonly<Record<string, unknown>> | undefined;
  readonly filePath?: string | undefined;
  readonly rawYaml?: string | undefined;
}

export interface AgentRoleDefinition {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly body: string;
  readonly filePath?: string | undefined;
  readonly frontmatter?: RoleContractFrontmatter | undefined;
  readonly raw?: string | undefined;
}

export interface AgentReferenceDoc {
  readonly id: string;
  readonly title: string;
  readonly filePath: string;
  readonly category: string;
  readonly description?: string | undefined;
  readonly sizeBytes: number;
  readonly format: "markdown" | "json";
  readonly content?: string | undefined;
  readonly referencedRoles?: readonly string[] | undefined;
}

export interface AgentTriadBundle {
  readonly role: string;
  readonly tier: number;
  readonly identity: AgentIdentity;
  readonly definition: AgentRoleDefinition;
  readonly references: readonly AgentReferenceDoc[];
  readonly isComplete: boolean;
  readonly validationIssues?: readonly string[] | undefined;
}

export interface TriadValidationResult {
  readonly valid: boolean;
  readonly role: string;
  readonly tier: number;
  readonly hasIdentity: boolean;
  readonly hasDefinition: boolean;
  readonly hasReferences: boolean;
  readonly referenceCount: number;
  readonly identityPath?: string | undefined;
  readonly definitionPath?: string | undefined;
  readonly referencePaths: readonly string[];
  readonly tierConsistent: boolean;
  readonly roleContractRefConsistent: boolean;
  readonly issues: readonly string[];
  readonly warnings: readonly string[];
}

export interface TriadAuditReport {
  readonly timestamp: string;
  readonly skillRoot: string;
  readonly totalRoles: number;
  readonly completeTriads: number;
  readonly incompleteTriads: number;
  readonly healthy: boolean;
  readonly triads: readonly TriadValidationResult[];
  readonly orphanedManifests: readonly string[];
  readonly orphanedContracts: readonly string[];
  readonly unreferencedReferences: readonly string[];
  readonly missingReferences: readonly string[];
  readonly issues: readonly string[];
  readonly summary: string;
}

export interface AgentTriadOptions {
  readonly skillRoot?: string | undefined;
  readonly agentsDir?: string | undefined;
  readonly rolesDir?: string | undefined;
  readonly referencesDir?: string | undefined;
  readonly strict?: boolean | undefined;
  readonly bypassCache?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Helper Functions for Path & Directory Resolution
// ---------------------------------------------------------------------------

function resolveWorkspacePaths(options?: AgentTriadOptions): {
  readonly skillRoot: string;
  readonly agentsDir: string;
  readonly rolesDir: string;
  readonly referencesDir: string;
} {
  const root = options?.skillRoot ? resolve(options.skillRoot) : findSkillRoot();
  const agents = options?.agentsDir ? resolve(options.agentsDir) : join(root, "agents");
  const roles = options?.rolesDir ? resolve(options.rolesDir) : join(root, "roles");
  const references = options?.referencesDir
    ? resolve(options.referencesDir)
    : join(root, "references");

  return {
    skillRoot: root,
    agentsDir: agents,
    rolesDir: roles,
    referencesDir: references,
  };
}

// ---------------------------------------------------------------------------
// Loading & Parsing Triad Components
// ---------------------------------------------------------------------------

export function loadAgentIdentity(roleInput: string, options?: AgentTriadOptions): AgentIdentity {
  const normRole = normalizeRoleName(roleInput);
  const { agentsDir } = resolveWorkspacePaths(options);

  const candidateNames = [
    `${normRole}.yaml`,
    `${normRole}.yml`,
    `${roleInput}.yaml`,
    `${roleInput}.yml`,
    normRole === "mechanic-validator" ? "mechanic_validator.yaml" : "",
    normRole === "ui-mechanic-validator" ? "ui-mechanic-validator.yaml" : "",
    normRole === "ui-validator" ? "ui-validator.yaml" : "",
  ].filter(Boolean);

  let targetPath: string | null = null;
  for (const name of candidateNames) {
    const p = join(agentsDir, name);
    if (existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (!targetPath && existsSync(agentsDir)) {
    try {
      const files = readdirSync(agentsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const full = join(agentsDir, file);
          const raw = readFileSync(full, "utf-8");
          const manifest = parseAgentManifest(raw, full);
          if (
            normalizeRoleName(manifest.role) === normRole ||
            normalizeRoleName(manifest.name) === normRole
          ) {
            targetPath = full;
            break;
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  if (!targetPath || !existsSync(targetPath)) {
    if (options?.strict) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Agent identity manifest not found for role '${normRole}' in ${agentsDir}`,
      );
    }

    const fallbackTier = roleToTier(normRole);
    return {
      name: normRole,
      role: normRole,
      tier: fallbackTier,
      displayName: `${normRole.charAt(0).toUpperCase() + normRole.slice(1)} Agent`,
      shortDescription: `Synthesized fallback agent identity for role ${normRole}`,
      provider: ["generic"],
      tools: {
        enable_subagent_tools: true,
        enable_write_tools:
          fallbackTier === 3 &&
          (normRole === "implementer" || normRole === "repairer" || normRole === "worker"),
      },
      filePath: undefined,
      rawYaml: undefined,
    };
  }

  const rawYaml = readFileSync(targetPath, "utf-8");
  const manifest: AgentManifest = parseAgentManifest(rawYaml, targetPath);

  const iface: AgentManifestInterface | undefined = manifest.interface;
  const displayName =
    iface?.display_name ??
    `${manifest.name.charAt(0).toUpperCase() + manifest.name.slice(1)} Agent`;
  const shortDescription =
    iface?.short_description ?? `Agent operating under the ${manifest.role} specification`;

  return {
    name: manifest.name,
    role: manifest.role,
    tier: manifest.tier,
    displayName,
    shortDescription,
    provider: manifest.provider,
    tools: manifest.tools ?? iface?.tools,
    config: manifest.config ?? iface?.config,
    protocol: manifest.protocol,
    milestoneNotifications: iface?.milestone_notifications,
    invariants: iface?.mind_invariants ?? iface?.coordinator_invariants,
    filePath: targetPath,
    rawYaml,
  };
}

export function loadAgentRoleDefinition(
  roleInput: string,
  options?: AgentTriadOptions,
): AgentRoleDefinition {
  const normRole = normalizeRoleName(roleInput);
  const { agentsDir } = resolveWorkspacePaths(options);

  const identity = loadAgentIdentity(normRole, options);

  if (!identity.filePath || !existsSync(identity.filePath)) {
    if (options?.strict) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Agent role definition contract not found for role '${normRole}' in ${agentsDir}`,
      );
    }

    const fallbackTier = roleToTier(normRole);
    return {
      role: normRole,
      tier: fallbackTier,
      domain: undefined,
      may: [`Operate as ${normRole} within authorized boundaries`],
      mustNot: [`Exceed ${normRole} role capabilities or write outside lease scope`],
      commands: ["task:claim", "task:heartbeat", "task:submit", "whoami"],
      spawns: [],
      body: `# Role: ${normRole}\n\nSynthesized fallback contract for role ${normRole}.`,
      filePath: undefined,
      frontmatter: { role: normRole, tier: fallbackTier },
      raw: undefined,
    };
  }

  const raw = identity.rawYaml ?? readFileSync(identity.filePath, "utf-8");
  const manifest: AgentManifest = parseAgentManifest(raw, identity.filePath);

  const may = manifest.permissions?.may ?? [`Operate as ${normRole} within authorized boundaries`];
  const mustNot = manifest.permissions?.must_not ?? [
    `Exceed ${normRole} role capabilities or write outside lease scope`,
  ];
  const commands = manifest.permissions?.commands ?? [
    "task:claim",
    "task:heartbeat",
    "task:submit",
    "whoami",
  ];
  const spawns = (manifest.permissions?.spawns ?? []) as string[];
  const body = manifest.instructions ?? "";

  return {
    role: manifest.role,
    tier: manifest.tier,
    domain: typeof manifest.domain === "string" ? manifest.domain : undefined,
    may,
    mustNot,
    commands,
    spawns,
    body,
    filePath: identity.filePath,
    frontmatter: {
      role: manifest.role,
      tier: manifest.tier,
      may,
      must_not: mustNot,
      commands,
      spawns,
    },
    raw,
  };
}

function extractDocTitle(content: string, fallbackId: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return fallbackId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function inferDocCategory(id: string): string {
  if (id.startsWith("cli")) return "cli";
  if (id.includes("protocol")) return "protocol";
  if (id.includes("playbook")) return "playbook";
  if (id.includes("state") || id.includes("matrix")) return "architecture";
  if (id.includes("failure")) return "diagnostics";
  if (id.includes("schema")) return "schema";
  if (id.includes("adapter")) return "adapters";
  if (id.includes("config")) return "configuration";
  return "general";
}

const KNOWN_ROLES_TO_MATCH = [
  "mind",
  "orchestrator",
  "mind-auditor",
  "coordinator",
  "implementer",
  "validator",
  "mechanic-validator",
  "ui-mechanic-validator",
  "ui-validator",
  "repairer",
  "completeness-critic",
  "planner",
  "plan-validator",
  "validator-code-quality",
  "validator-ui-design",
  "validator-security",
  "validator-product",
  "validator-system-design",
  "sub-implementer",
  "sub-validator",
  "sub-investigator",
];

function extractReferencedRoles(content: string): readonly string[] {
  const found = new Set<string>();
  const lower = content.toLowerCase();
  for (const r of KNOWN_ROLES_TO_MATCH) {
    const pattern = new RegExp(`\\b${r}\\b`, "i");
    if (pattern.test(lower)) {
      found.add(r);
    }
  }
  return Array.from(found).sort();
}

export function loadAgentReferenceDocs(options?: AgentTriadOptions): readonly AgentReferenceDoc[] {
  const { referencesDir } = resolveWorkspacePaths(options);
  if (!existsSync(referencesDir)) {
    return [];
  }

  const docs: AgentReferenceDoc[] = [];
  try {
    const files = readdirSync(referencesDir);
    for (const file of files) {
      if (file.endsWith(".md") || file.endsWith(".json")) {
        const fullPath = join(referencesDir, file);
        const st = statSync(fullPath);
        const ext = extname(file);
        const id = basename(file, ext);
        const format = ext === ".json" ? "json" : "markdown";
        const content = readFileSync(fullPath, "utf-8");
        const title = format === "markdown" ? extractDocTitle(content, id) : `${id} (Schema)`;
        const category = inferDocCategory(id);
        const referencedRoles = extractReferencedRoles(content);

        docs.push({
          id,
          title,
          filePath: fullPath,
          category,
          description: `Reference documentation for ${title}`,
          sizeBytes: st.size,
          format,
          content,
          referencedRoles,
        });
      }
    }
  } catch {
    // Non-fatal, return collected docs
  }

  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

export function findRelevantReferencesForRole(
  roleInput: string,
  allDocs: readonly AgentReferenceDoc[],
  identity?: AgentIdentity,
  definition?: AgentRoleDefinition,
): readonly AgentReferenceDoc[] {
  const normRole = normalizeRoleName(roleInput);
  const relevant: AgentReferenceDoc[] = [];

  const instructions = identity?.protocol?.instructions ?? "";
  const contractBody = definition?.body ?? "";
  const combinedContext = `${instructions} ${contractBody}`.toLowerCase();

  for (const doc of allDocs) {
    const docIdLower = doc.id.toLowerCase();
    const docRefRegex = new RegExp(`\\b${docIdLower}\\b`, "i");

    // 1. Direct mention in protocol instructions or contract body
    if (docRefRegex.test(combinedContext)) {
      relevant.push(doc);
      continue;
    }

    // 2. Referenced in doc roles
    if (doc.referencedRoles && doc.referencedRoles.includes(normRole)) {
      relevant.push(doc);
      continue;
    }

    // 3. General references relevant to all execution roles (e.g. cli-capabilities, protocol, configuration)
    if (
      doc.id === "cli-capabilities" ||
      doc.id === "protocol" ||
      doc.id === "configuration" ||
      doc.id === "cli"
    ) {
      relevant.push(doc);
    }
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  return relevant.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 1. validateAgentTriad
// ---------------------------------------------------------------------------

export function validateAgentTriad(
  roleInput: string,
  options?: AgentTriadOptions,
): TriadValidationResult {
  const normRole = normalizeRoleName(roleInput);

  const issues: string[] = [];
  const warnings: string[] = [];

  // Check identity in agents/
  const identity = loadAgentIdentity(normRole, options);
  const hasIdentity = Boolean(identity.filePath && existsSync(identity.filePath));
  if (!hasIdentity) {
    issues.push(`Missing agent identity manifest in agents/ for role '${normRole}'`);
  }

  // Check definition in agents/
  const definition = loadAgentRoleDefinition(normRole, options);
  const hasDefinition = Boolean(definition.filePath && existsSync(definition.filePath));
  if (!hasDefinition) {
    issues.push(`Missing agent role definition in agents/ for role '${normRole}'`);
  }

  // Check tier consistency
  let tierConsistent = true;
  if (hasIdentity && hasDefinition) {
    if (identity.tier !== definition.tier) {
      tierConsistent = false;
      issues.push(
        `Tier mismatch: manifest specifies Tier ${identity.tier}, but role contract specifies Tier ${definition.tier}`,
      );
    }
  }

  // Check role_contract path consistency if defined in manifest protocol
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

  // Check references
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

// ---------------------------------------------------------------------------
// 2. auditAgentTriadWorkspace
// ---------------------------------------------------------------------------

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

  // Union of all roles discovered from agents/
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

// ---------------------------------------------------------------------------
// 3. synthesizeTriadManifest
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 4. assertTriadIntegrity
// ---------------------------------------------------------------------------

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

import { createHash } from "node:crypto";
import { findCommand } from "../cli/registry/index.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { HarnessError } from "../errors/harness-error.ts";
import type {
  RoleCheatSheet,
  RoleCheatSheetOptions,
  RoleCommandCheatSheet,
} from "../roles/cheat-sheets.ts";

/**
 * Fundamental role archetypes spanning the 4-tier autonomous hierarchy.
 */
export type RoleArchetype =
  | "tier_0_mind"
  | "tier_1_orchestrator"
  | "tier_2_coordinator"
  | "tier_3_implementer"
  | "tier_3_validator"
  | "tier_3_repairer"
  | "tier_3_critic"
  | "tier_3_specialist";

/**
 * Domain specializations for dynamic role synthesis.
 */
export type RoleSpecializationDomain =
  | "code-quality"
  | "security"
  | "system-design"
  | "product"
  | "ui-design"
  | "performance"
  | "reliability"
  | "documentation"
  | "defect-investigation"
  | "concurrency"
  | "type-safety"
  | "general";

/**
 * Policy governing write scope access for a synthesized role.
 */
export type WriteScopePolicy = "forbidden" | "lease_bounded" | "unrestricted" | "domain_isolated";

/**
 * Lineage tracking entry for evolved dynamic roles.
 */
export interface RoleLineageEntry {
  readonly version: number;
  readonly timestamp: string;
  readonly mutationReason: string;
  readonly previousSha256: string;
  readonly changedFields: readonly string[];
}

/**
 * Specification for a dynamic role.
 */
export interface DynamicRoleSpec {
  readonly name: string;
  readonly archetype: RoleArchetype;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly grantedCommands: readonly string[];
  readonly permittedActivities: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly invariants: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars: readonly string[];
  readonly writeScopePolicy: WriteScopePolicy;
  readonly version?: number | undefined;
  readonly parentRole?: string | undefined;
  readonly lineage?: readonly RoleLineageEntry[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Complete synthesized role contract object with parsed data, raw markdown, and sha256.
 */
export interface DynamicRoleContract {
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly must_not: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars: readonly string[];
  readonly writeScopePolicy: WriteScopePolicy;
  readonly spec: DynamicRoleSpec;
  readonly markdown: string;
  readonly rawFrontmatter: string;
  readonly rawBody: string;
  readonly sha256: string;
}

/**
 * Result of validating a dynamic role specification.
 */
export interface DynamicRoleValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly roleName: string;
  readonly tier: number;
}

/**
 * Options for synthesizing a dynamic role.
 */
export interface SynthesizeRoleOptions {
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
}

/**
 * Input parameters for synthesizing roles from task requirements.
 */
export interface TaskRoleSynthesisParams {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly domain?: string | undefined;
  readonly complexity?: "low" | "medium" | "high" | "critical" | undefined;
  readonly requiresRepair?: boolean | undefined;
  readonly candidateId?: string | undefined;
  readonly feedbackId?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
}

/**
 * Dual role synthesis plan ensuring 1:1 implementer-validator pairing and anti-batching compliance.
 */
export interface DynamicRoleSynthesisPlan {
  readonly taskId: string;
  readonly implementerRole: DynamicRoleContract;
  readonly validatorRole: DynamicRoleContract;
  readonly validationSummary: string;
  readonly antiBatchingCompliant: boolean;
  readonly antiBoundaryLeakGuaranteed: boolean;
}

/**
 * Parameters for synthesizing roles from a defect remediation context.
 */
export interface DefectRoleSynthesisParams {
  readonly defectId: string;
  readonly defectType: string;
  readonly rootCause: string;
  readonly affectedScope: readonly string[];
  readonly correctiveAction: string;
  readonly requiredInvariants?: readonly string[] | undefined;
}

/**
 * Role mutation options for evolutionary feedback integration.
 */
export interface RoleMutationFeedback {
  readonly mutationReason: string;
  readonly newInvariants?: readonly string[] | undefined;
  readonly newPillars?: readonly string[] | undefined;
  readonly additionalCommands?: readonly string[] | undefined;
  readonly removedCommands?: readonly string[] | undefined;
  readonly additionalProhibitions?: readonly string[] | undefined;
  readonly metadataUpdate?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Export structure for dynamic role catalogs.
 */
export interface DynamicRoleCatalogExport {
  readonly exportedAt: string;
  readonly totalRoles: number;
  readonly roles: readonly DynamicRoleSpec[];
}

/**
 * Filter options for role registry queries.
 */
export interface DynamicRoleFilter {
  readonly tier?: number | undefined;
  readonly domain?: string | undefined;
  readonly archetype?: RoleArchetype | undefined;
  readonly writeScopePolicy?: WriteScopePolicy | undefined;
}

// Canonical defaults by archetype
const ARCHETYPE_TIER_MAP: Readonly<Record<RoleArchetype, number>> = {
  tier_0_mind: 0,
  tier_1_orchestrator: 1,
  tier_2_coordinator: 2,
  tier_3_implementer: 3,
  tier_3_validator: 3,
  tier_3_repairer: 3,
  tier_3_critic: 3,
  tier_3_specialist: 3,
};

const ARCHETYPE_DEFAULT_COMMANDS: Readonly<Record<RoleArchetype, readonly string[]>> = {
  tier_0_mind: [
    "mind:round-open",
    "mind:round-close",
    "mind:pulse",
    "mind:wake",
    "mind:quiesce",
    "mind:self-evolve",
    "mind:audit",
    "doctor",
    "summary:export",
  ],
  tier_1_orchestrator: [
    "mind:round-open",
    "mind:round-close",
    "orchestrator:supervise",
    "recover",
    "doctor",
    "summary:export",
  ],
  tier_2_coordinator: [
    "plan:compile",
    "queue:wave",
    "task:ready",
    "task:retry",
    "gate:check",
    "doctor",
    "summary:export",
  ],
  tier_3_implementer: ["task:claim", "task:heartbeat", "task:submit", "run:exec"],
  tier_3_validator: ["gate:check", "validator:findings", "evidence:record", "critic:evaluate"],
  tier_3_repairer: ["task:claim", "task:heartbeat", "task:submit", "run:exec", "recover"],
  tier_3_critic: ["critic:evaluate", "gate:check", "evidence:record"],
  tier_3_specialist: ["task:claim", "task:heartbeat", "task:submit", "run:exec"],
};

const ARCHETYPE_DEFAULT_SPAWNS: Readonly<Record<RoleArchetype, readonly string[]>> = {
  tier_0_mind: ["orchestrator"],
  tier_1_orchestrator: ["coordinator"],
  tier_2_coordinator: [
    "planner",
    "implementer",
    "validator",
    "repairer",
    "completeness-critic",
    "plan-validator",
  ],
  tier_3_implementer: [],
  tier_3_validator: [],
  tier_3_repairer: [],
  tier_3_critic: [],
  tier_3_specialist: [],
};

const ARCHETYPE_DEFAULT_WRITE_POLICY: Readonly<Record<RoleArchetype, WriteScopePolicy>> = {
  tier_0_mind: "forbidden",
  tier_1_orchestrator: "forbidden",
  tier_2_coordinator: "forbidden",
  tier_3_implementer: "lease_bounded",
  tier_3_validator: "forbidden",
  tier_3_repairer: "lease_bounded",
  tier_3_critic: "forbidden",
  tier_3_specialist: "lease_bounded",
};

const FORBIDDEN_COMMANDS = new Set<string>(["orchestrator:run"]);

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;

/**
 * Formats command syntax for cheat-sheet generation.
 */
function formatCommandSyntax(spec: CommandSpec): {
  syntax: string;
  requiredFlags: string[];
  optionalFlags: string[];
} {
  const requiredFlags: string[] = [];
  const optionalFlags: string[] = [];
  const parts: string[] = [`bun harness.ts ${spec.name}`];

  for (const flag of spec.flags) {
    const isBool = flag.type === "bool";
    const valuePlaceholder = isBool ? "" : ` <${flag.type}>`;
    const flagStr = `--${flag.name}${valuePlaceholder}`;

    if (flag.required) {
      requiredFlags.push(flag.name);
      parts.push(flagStr);
    } else {
      optionalFlags.push(flag.name);
    }
  }

  if (optionalFlags.length > 0) {
    parts.push(`[--flags...]`);
  }

  return {
    syntax: parts.join(" "),
    requiredFlags,
    optionalFlags,
  };
}

/**
 * Builds a command cheat sheet object from a registered CLI command name.
 */
function buildCommandCheatSheet(commandName: string): RoleCommandCheatSheet {
  const spec = findCommand(commandName);
  if (!spec) {
    return {
      name: commandName,
      summary: `Harness command: ${commandName}`,
      syntax: `bun harness.ts ${commandName}`,
      requiredFlags: [],
      optionalFlags: [],
      examples: [`bun harness.ts ${commandName}`],
    };
  }

  const { syntax, requiredFlags, optionalFlags } = formatCommandSyntax(spec);
  return {
    name: spec.name,
    summary: spec.summary,
    syntax,
    requiredFlags,
    optionalFlags,
    examples: spec.examples.length > 0 ? spec.examples : [syntax],
  };
}

/**
 * Validates a dynamic role specification against architecture invariants.
 */
export function validateDynamicRoleSpec(spec: DynamicRoleSpec): DynamicRoleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Name validation
  if (!spec.name || typeof spec.name !== "string" || !ROLE_NAME_PATTERN.test(spec.name)) {
    errors.push(`Role name '${spec.name}' is invalid. Must match pattern ^[a-z][a-z0-9_-]*$.`);
  }

  // Tier validation
  if (!Number.isSafeInteger(spec.tier) || spec.tier < 0 || spec.tier > 3) {
    errors.push(`Tier must be an integer between 0 and 3, got: ${spec.tier}.`);
  }

  // Archetype-tier consistency
  const expectedTier = ARCHETYPE_TIER_MAP[spec.archetype];
  if (expectedTier !== undefined && spec.tier !== expectedTier) {
    errors.push(
      `Archetype '${spec.archetype}' expects Tier ${expectedTier}, but specification assigned Tier ${spec.tier}.`,
    );
  }

  // Anti-Boundary-Leak Invariant for Validators & Critics
  if (spec.archetype === "tier_3_validator" || spec.archetype === "tier_3_critic") {
    if (spec.writeScopePolicy !== "forbidden") {
      errors.push(
        `Anti-Boundary-Leak Violation: Validator/Critic archetype '${spec.archetype}' must have writeScopePolicy 'forbidden', got '${spec.writeScopePolicy}'.`,
      );
    }

    const hasWriteMay = spec.permittedActivities.some(
      (act) =>
        act.toLowerCase().includes("write") ||
        act.toLowerCase().includes("edit") ||
        act.toLowerCase().includes("claim lease") ||
        act.toLowerCase().includes("modify file"),
    );
    if (hasWriteMay) {
      errors.push(
        `Anti-Boundary-Leak Violation: Validator/Critic permitted activities contain write actions.`,
      );
    }

    const hasAntiLeakMustNot = spec.prohibitedActions.some(
      (act) =>
        act.toLowerCase().includes("claim code write lease") ||
        act.toLowerCase().includes("edit source") ||
        act.toLowerCase().includes("write files") ||
        act.toLowerCase().includes("anti-boundary-leak"),
    );
    if (!hasAntiLeakMustNot) {
      warnings.push(
        `Validator/Critic role should explicitly contain Anti-Boundary-Leak prohibition in must_not.`,
      );
    }
  }

  // Forbidden command check
  for (const cmd of spec.grantedCommands) {
    if (FORBIDDEN_COMMANDS.has(cmd)) {
      errors.push(`Command '${cmd}' is strictly forbidden across all role specifications.`);
    }
  }

  // Tier spawn restrictions (no cross-tier or upward dispatch)
  for (const spawned of spec.spawns) {
    if (spec.tier === 3) {
      errors.push(
        `Tier 3 roles are leaf execution workers and cannot spawn subagents, but '${spec.name}' declared spawn '${spawned}'.`,
      );
    } else if (spec.tier === 1 && spawned !== "coordinator") {
      errors.push(
        `Tier 1 Orchestrator may only spawn Tier 2 'coordinator', but declared spawn '${spawned}'.`,
      );
    } else if (spec.tier === 0 && spawned !== "orchestrator") {
      errors.push(
        `Tier 0 Mind may only spawn Tier 1 'orchestrator', but declared spawn '${spawned}'.`,
      );
    }
  }

  // Cognitive pillars validation for hyper-consciousness
  if (!spec.cognitivePillars || spec.cognitivePillars.length === 0) {
    warnings.push(
      `Role '${spec.name}' has no cognitive pillars defined. Hyper-conscious operations recommend at least 2 pillars.`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    roleName: spec.name,
    tier: spec.tier,
  };
}

/**
 * Formats a DynamicRoleSpec into YAML frontmatter string.
 */
export function formatDynamicRoleFrontmatter(spec: DynamicRoleSpec): string {
  const lines: string[] = ["---"];
  lines.push(`role: ${spec.name}`);
  lines.push(`tier: ${spec.tier}`);

  if (spec.domain !== undefined && spec.domain.trim() !== "") {
    lines.push(`domain: ${spec.domain.trim()}`);
  }

  lines.push("may:");
  if (spec.permittedActivities.length === 0) {
    lines.push("  - []");
  } else {
    for (const act of spec.permittedActivities) {
      lines.push(`  - ${act}`);
    }
  }

  lines.push("must_not:");
  if (spec.prohibitedActions.length === 0) {
    lines.push("  - []");
  } else {
    for (const act of spec.prohibitedActions) {
      lines.push(`  - ${act}`);
    }
  }

  lines.push("commands:");
  if (spec.grantedCommands.length === 0) {
    lines.push("  - []");
  } else {
    for (const cmd of spec.grantedCommands) {
      lines.push(`  - ${cmd}`);
    }
  }

  lines.push("spawns:");
  if (spec.spawns.length === 0) {
    lines.push("  - []");
  } else {
    for (const sp of spec.spawns) {
      lines.push(`  - ${sp}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Formats a DynamicRoleSpec into markdown prose body.
 */
export function formatDynamicRoleBody(spec: DynamicRoleSpec): string {
  const lines: string[] = [];
  lines.push(`# ${spec.title}`);
  lines.push("");
  lines.push(spec.summary);
  lines.push("");

  if (spec.cognitivePillars.length > 0) {
    lines.push("## Cognitive Pillars");
    for (const pillar of spec.cognitivePillars) {
      lines.push(`- ${pillar}`);
    }
    lines.push("");
  }

  lines.push("## Architectural Constraints & Invariants");
  lines.push(`- **Authority Tier**: Tier ${spec.tier}`);
  lines.push(`- **Archetype**: \`${spec.archetype}\``);
  lines.push(`- **Write Scope Policy**: \`${spec.writeScopePolicy}\``);

  if (spec.domain !== undefined) {
    lines.push(`- **Specialization Domain**: \`${spec.domain}\``);
  }

  for (const inv of spec.invariants) {
    lines.push(`- **Invariant**: ${inv}`);
  }

  if (spec.version !== undefined) {
    lines.push(`- **Generation Version**: v${spec.version}`);
  }

  if (spec.parentRole !== undefined) {
    lines.push(`- **Parent Lineage**: \`${spec.parentRole}\``);
  }

  return lines.join("\n");
}

/**
 * Formats a complete markdown role contract document.
 */
export function formatDynamicRoleMarkdown(spec: DynamicRoleSpec): string {
  const frontmatter = formatDynamicRoleFrontmatter(spec);
  const body = formatDynamicRoleBody(spec);
  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Synthesizes a new DynamicRoleContract from options with rigorous invariant enforcement.
 */
export function synthesizeDynamicRole(options: SynthesizeRoleOptions): DynamicRoleContract {
  const tier = options.tier ?? ARCHETYPE_TIER_MAP[options.archetype] ?? 3;
  const defaultCommands = ARCHETYPE_DEFAULT_COMMANDS[options.archetype] ?? [];
  const defaultSpawns = ARCHETYPE_DEFAULT_SPAWNS[options.archetype] ?? [];
  const defaultWritePolicy = ARCHETYPE_DEFAULT_WRITE_POLICY[options.archetype] ?? "lease_bounded";

  const grantedCommands = options.grantedCommands ?? [...defaultCommands];
  const spawns = options.spawns ?? [...defaultSpawns];
  const writeScopePolicy = options.writeScopePolicy ?? defaultWritePolicy;

  // Build default permitted activities
  const permittedActivities = options.permittedActivities ?? [
    options.archetype === "tier_3_validator" || options.archetype === "tier_3_critic"
      ? "Execute test suites and verify gates in read-only mode"
      : "Claim leased write scope and execute assigned task",
    "Emit structured findings and telemetry",
  ];

  // Build default prohibitions with Anti-Boundary-Leak rule for validators
  const defaultProhibitions: string[] = [];
  if (options.archetype === "tier_3_validator" || options.archetype === "tier_3_critic") {
    defaultProhibitions.push(
      "Claim code write leases, edit source files, or modify repository code directly (Anti-Boundary-Leak Rule)",
    );
    defaultProhibitions.push("Validate own implementations or execute self-validation");
  } else {
    defaultProhibitions.push("Touch files outside assigned leased write scope");
    defaultProhibitions.push("Introduce TypeScript `any`, @ts-ignore, or @ts-expect-error");
  }

  const prohibitedActions = options.prohibitedActions ?? defaultProhibitions;

  // Default cognitive pillars
  const defaultPillars: string[] = [
    "Strict Zero-Any & Zero-Suppression TypeScript Discipline",
    "Absolute Write Scope Confinement & Isolation",
    "Hyper-Conscious Telemetry & Deterministic Verification",
  ];
  const cognitivePillars = options.cognitivePillars ?? defaultPillars;

  const invariants = options.invariants ?? [
    "Strict compliance with 4-tier authority hierarchy",
    "Deterministic reproducible verification",
  ];

  const title =
    options.title ??
    options.name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const summary =
    options.summary ??
    `Dynamic synthesized role '${options.name}' (${options.archetype}) operating at Tier ${tier}.`;

  const spec: DynamicRoleSpec = {
    name: options.name,
    archetype: options.archetype,
    tier,
    title,
    summary,
    domain: options.domain,
    grantedCommands,
    permittedActivities,
    prohibitedActions,
    invariants,
    spawns,
    cognitivePillars,
    writeScopePolicy,
    version: options.version ?? 1,
    parentRole: options.parentRole,
    metadata: options.metadata,
  };

  const validation = validateDynamicRoleSpec(spec);
  if (!validation.valid) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Dynamic role synthesis failed for '${spec.name}': ${validation.errors.join("; ")}`,
      validation.errors,
    );
  }

  const rawFrontmatter = formatDynamicRoleFrontmatter(spec);
  const rawBody = formatDynamicRoleBody(spec);
  const markdown = `${rawFrontmatter}\n\n${rawBody}\n`;
  const bytes = new TextEncoder().encode(markdown);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    role: spec.name,
    tier: spec.tier,
    title: spec.title,
    summary: spec.summary,
    domain: spec.domain,
    may: spec.permittedActivities,
    must_not: spec.prohibitedActions,
    commands: spec.grantedCommands,
    spawns: spec.spawns,
    cognitivePillars: spec.cognitivePillars,
    writeScopePolicy: spec.writeScopePolicy,
    spec,
    markdown,
    rawFrontmatter,
    rawBody,
    sha256,
  };
}

/**
 * Parses dynamic role frontmatter and markdown document.
 */
export function parseDynamicRoleContract(
  content: string | Uint8Array,
  source = "dynamic-role.md",
): DynamicRoleContract {
  const text = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
  const lines = text.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new HarnessError(
      "INTEGRITY",
      `Role contract in ${source} does not start with frontmatter fence (---).`,
    );
  }

  const endFenceIndex = lines.indexOf("---", 1);
  if (endFenceIndex === -1) {
    throw new HarnessError(
      "INTEGRITY",
      `Role contract in ${source} contains unterminated frontmatter fence.`,
    );
  }

  const frontmatterLines = lines.slice(1, endFenceIndex);
  const rawBody = lines
    .slice(endFenceIndex + 1)
    .join("\n")
    .trim();

  let roleName: string | undefined;
  let tier: number | undefined;
  let domain: string | undefined;
  const may: string[] = [];
  const must_not: string[] = [];
  const commands: string[] = [];
  const spawns: string[] = [];

  let currentList: "may" | "must_not" | "commands" | "spawns" | null = null;

  for (const line of frontmatterLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim();
      if (item === "[]") continue;
      if (currentList === "may") may.push(item);
      else if (currentList === "must_not") must_not.push(item);
      else if (currentList === "commands") commands.push(item);
      else if (currentList === "spawns") spawns.push(item);
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key === "role") {
      roleName = value;
      currentList = null;
    } else if (key === "tier") {
      const parsedTier = Number(value);
      if (!Number.isSafeInteger(parsedTier) || parsedTier < 0 || parsedTier > 3) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Invalid tier '${value}' in ${source}. Must be integer 0..3.`,
        );
      }
      tier = parsedTier;
      currentList = null;
    } else if (key === "domain") {
      domain = value;
      currentList = null;
    } else if (key === "may") {
      currentList = "may";
    } else if (key === "must_not") {
      currentList = "must_not";
    } else if (key === "commands") {
      currentList = "commands";
    } else if (key === "spawns") {
      currentList = "spawns";
    } else {
      currentList = null;
    }
  }

  if (!roleName) {
    throw new HarnessError("INTEGRITY", `Missing 'role' property in frontmatter of ${source}.`);
  }
  if (tier === undefined) {
    throw new HarnessError("INTEGRITY", `Missing 'tier' property in frontmatter of ${source}.`);
  }

  // Extract cognitive pillars and prose details from body
  const bodyLines = rawBody.split("\n");
  let title = roleName;
  const cognitivePillars: string[] = [];
  const leadParagraphs: string[] = [];
  let inPillars = false;

  for (const bLine of bodyLines) {
    const trimmed = bLine.trim();
    if (trimmed.startsWith("# ") && title === roleName) {
      title = trimmed.slice(2).trim();
      continue;
    }
    if (trimmed.startsWith("## Cognitive Pillars")) {
      inPillars = true;
      continue;
    }
    if (inPillars && trimmed.startsWith("## ")) {
      inPillars = false;
    }
    if (inPillars && trimmed.startsWith("- ")) {
      cognitivePillars.push(trimmed.slice(2).trim());
      continue;
    }
    if (
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      trimmed.length > 0 &&
      leadParagraphs.length < 2
    ) {
      leadParagraphs.push(trimmed);
    }
  }

  const summary = leadParagraphs.join(" ") || `Role contract for ${roleName}`;
  const archetype: RoleArchetype =
    tier === 0
      ? "tier_0_mind"
      : tier === 1
        ? "tier_1_orchestrator"
        : tier === 2
          ? "tier_2_coordinator"
          : roleName.includes("validator") || roleName.includes("critic")
            ? "tier_3_validator"
            : roleName.includes("repair")
              ? "tier_3_repairer"
              : "tier_3_implementer";

  const writeScopePolicy: WriteScopePolicy =
    tier === 3 && (roleName.includes("validator") || roleName.includes("critic"))
      ? "forbidden"
      : tier === 3
        ? "lease_bounded"
        : "forbidden";

  const spec: DynamicRoleSpec = {
    name: roleName,
    archetype,
    tier,
    title,
    summary,
    domain,
    grantedCommands: commands,
    permittedActivities: may,
    prohibitedActions: must_not,
    invariants: [],
    spawns,
    cognitivePillars,
    writeScopePolicy,
  };

  const rawFrontmatter = lines.slice(0, endFenceIndex + 1).join("\n");
  const bytes = new TextEncoder().encode(text);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    role: roleName,
    tier,
    title,
    summary,
    domain,
    may,
    must_not,
    commands,
    spawns,
    cognitivePillars,
    writeScopePolicy,
    spec,
    markdown: text,
    rawFrontmatter,
    rawBody,
    sha256,
  };
}

/**
 * Synthesizes a paired 1:1 Implementer and Validator duo for a specific task.
 * Enforces Anti-Batching & Independent Validation (Anti-Self-Validation).
 */
export function synthesizeRoleFromTaskRequirements(
  params: TaskRoleSynthesisParams,
): DynamicRoleSynthesisPlan {
  const domainTag = params.domain ?? "general";
  const isRepair = params.requiresRepair === true;

  const implementerRoleName = isRepair
    ? `repairer-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`
    : `implementer-${domainTag}-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  const validatorRoleName = `validator-${domainTag}-${params.taskId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  // Implementer synthesis
  const implementerRole = synthesizeDynamicRole({
    name: implementerRoleName,
    archetype: isRepair ? "tier_3_repairer" : "tier_3_implementer",
    domain: domainTag,
    title: isRepair
      ? `Specialized Repairer for Task ${params.taskId}`
      : `Specialized Implementer for Task ${params.taskId}`,
    summary: `Dedicated implementer executing task '${params.taskTitle}' within bounded write scope.`,
    writeScopePolicy: "lease_bounded",
    permittedActivities: [
      `Claim leased write scope for task ${params.taskId}`,
      `Edit files strictly within write scope: [${params.writeScope.join(", ")}]`,
      `Execute task verification gate: \`${params.gate}\``,
      "Submit task with deterministic command evidence",
    ],
    prohibitedActions: [
      "Touch any files outside leased write scope",
      "Introduce TypeScript `any`, @ts-ignore, or @ts-expect-error",
      "Perform self-validation or sign off on validator duties",
    ],
    cognitivePillars: [
      "Strict Zero-Any & Zero-Suppression TypeScript Discipline",
      `Confinement to write scope: [${params.writeScope.join(", ")}]`,
      "1:1 Task Isolation & Anti-Batching Integrity",
    ],
    metadata: {
      taskId: params.taskId,
      candidateId: params.candidateId,
      feedbackId: params.feedbackId,
    },
  });

  // Validator synthesis with Anti-Boundary-Leak enforcement
  const validatorRole = synthesizeDynamicRole({
    name: validatorRoleName,
    archetype: "tier_3_validator",
    domain: domainTag,
    title: `Independent Validator for Task ${params.taskId}`,
    summary: `Independent read-only validator evaluating task '${params.taskTitle}' against gate '${params.gate}'.`,
    writeScopePolicy: "forbidden",
    permittedActivities: [
      `Execute verification gate: \`${params.gate}\``,
      "Inspect code diffs against strict zero-any and zero-suppression rules",
      "Emit structured validation findings and pass/fail verdict",
    ],
    prohibitedActions: [
      "Claim code write leases, edit files, or modify repository code directly (Anti-Boundary-Leak Rule)",
      "Validate own code or execute implementer commands",
    ],
    cognitivePillars: [
      "Independent & Adversarial Verification",
      "Strict Read-Only Anti-Boundary-Leak Enforcement",
      "Zero False Positives & Deterministic Gate Evaluation",
    ],
    metadata: {
      taskId: params.taskId,
      validatedImplementer: implementerRoleName,
    },
  });

  return {
    taskId: params.taskId,
    implementerRole,
    validatorRole,
    validationSummary: `Synthesized 1:1 paired Implementer (${implementerRoleName}) and independent Validator (${validatorRoleName}) for task ${params.taskId}.`,
    antiBatchingCompliant: true,
    antiBoundaryLeakGuaranteed: true,
  };
}

/**
 * Synthesizes a specialized role from defect remediation context.
 */
export function synthesizeRoleFromDefectRemediation(
  params: DefectRoleSynthesisParams,
): DynamicRoleContract {
  const roleName = `remediator-defect-${params.defectId.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  const defaultPillars = [
    `Remediation of Defect: ${params.defectType}`,
    `Root Cause Defense: ${params.rootCause}`,
    "Strict Anti-Regression Verification",
  ];

  const prohibitedActions = [
    "Touch files outside affected defect scope",
    "Re-introduce identical defect signature pattern",
    "Introduce TypeScript `any` or suppressions",
  ];

  const invariants = [
    `Remediation Target: ${params.defectId}`,
    `Action: ${params.correctiveAction}`,
    ...(params.requiredInvariants ?? []),
  ];

  return synthesizeDynamicRole({
    name: roleName,
    archetype: "tier_3_repairer",
    domain: "defect-investigation",
    title: `Defect Remediation Specialist: ${params.defectId}`,
    summary: `Specialized repairer synthesized to fix defect '${params.defectId}' (${params.defectType}) without regressions.`,
    writeScopePolicy: "lease_bounded",
    permittedActivities: [
      `Claim write scope for defect remediation: [${params.affectedScope.join(", ")}]`,
      `Apply corrective action: ${params.correctiveAction}`,
      "Run targeted regression test suite",
    ],
    prohibitedActions,
    invariants,
    cognitivePillars: defaultPillars,
    metadata: {
      defectId: params.defectId,
      defectType: params.defectType,
    },
  });
}

/**
 * Mutates an existing dynamic role with evolutionary feedback while maintaining lineage.
 */
export function mutateRoleWithFeedback(
  role: DynamicRoleContract,
  feedback: RoleMutationFeedback,
): DynamicRoleContract {
  const currentSpec = role.spec;
  const currentVersion = currentSpec.version ?? 1;
  const newVersion = currentVersion + 1;

  const updatedInvariants = [...currentSpec.invariants, ...(feedback.newInvariants ?? [])];

  const updatedPillars = [...currentSpec.cognitivePillars, ...(feedback.newPillars ?? [])];

  const removedCmdSet = new Set(feedback.removedCommands ?? []);
  const updatedCommands = [
    ...currentSpec.grantedCommands.filter((c) => !removedCmdSet.has(c)),
    ...(feedback.additionalCommands ?? []),
  ];

  const updatedProhibitions = [
    ...currentSpec.prohibitedActions,
    ...(feedback.additionalProhibitions ?? []),
  ];

  const changedFields: string[] = [];
  if (feedback.newInvariants?.length) changedFields.push("invariants");
  if (feedback.newPillars?.length) changedFields.push("cognitivePillars");
  if (feedback.additionalCommands?.length || feedback.removedCommands?.length)
    changedFields.push("grantedCommands");
  if (feedback.additionalProhibitions?.length) changedFields.push("prohibitedActions");

  const newLineageEntry: RoleLineageEntry = {
    version: currentVersion,
    timestamp: new Date().toISOString(),
    mutationReason: feedback.mutationReason,
    previousSha256: role.sha256,
    changedFields,
  };

  const updatedLineage = [...(currentSpec.lineage ?? []), newLineageEntry];

  const mutatedSpec: DynamicRoleSpec = {
    ...currentSpec,
    version: newVersion,
    parentRole: currentSpec.name,
    invariants: updatedInvariants,
    cognitivePillars: updatedPillars,
    grantedCommands: updatedCommands,
    prohibitedActions: updatedProhibitions,
    lineage: updatedLineage,
    metadata: {
      ...currentSpec.metadata,
      ...feedback.metadataUpdate,
      lastMutationReason: feedback.mutationReason,
    },
  };

  const validation = validateDynamicRoleSpec(mutatedSpec);
  if (!validation.valid) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Role mutation failed validation for '${mutatedSpec.name}': ${validation.errors.join("; ")}`,
      validation.errors,
    );
  }

  const rawFrontmatter = formatDynamicRoleFrontmatter(mutatedSpec);
  const rawBody = formatDynamicRoleBody(mutatedSpec);
  const markdown = `${rawFrontmatter}\n\n${rawBody}\n`;
  const bytes = new TextEncoder().encode(markdown);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    role: mutatedSpec.name,
    tier: mutatedSpec.tier,
    title: mutatedSpec.title,
    summary: mutatedSpec.summary,
    domain: mutatedSpec.domain,
    may: mutatedSpec.permittedActivities,
    must_not: mutatedSpec.prohibitedActions,
    commands: mutatedSpec.grantedCommands,
    spawns: mutatedSpec.spawns,
    cognitivePillars: mutatedSpec.cognitivePillars,
    writeScopePolicy: mutatedSpec.writeScopePolicy,
    spec: mutatedSpec,
    markdown,
    rawFrontmatter,
    rawBody,
    sha256,
  };
}

/**
 * Generates a RoleCheatSheet from a DynamicRoleContract or DynamicRoleSpec.
 */
export function generateDynamicRoleCheatSheet(
  roleOrSpec: DynamicRoleContract | DynamicRoleSpec,
  options?: RoleCheatSheetOptions | undefined,
): RoleCheatSheet {
  const spec = "spec" in roleOrSpec ? roleOrSpec.spec : roleOrSpec;
  const commandDetails = spec.grantedCommands.map(buildCommandCheatSheet);

  const lines: string[] = [];
  if (options?.compact) {
    lines.push(`### ⚡ Compact Cheat-Sheet: \`${spec.name}\` (Tier ${spec.tier})`);
    lines.push(
      `**Granted Commands (${spec.grantedCommands.length})**: ${spec.grantedCommands.map((c) => `\`${c}\``).join(", ")}`,
    );
    lines.push(
      `**Spawns (${spec.spawns.length})**: ${spec.spawns.length > 0 ? spec.spawns.map((s) => `\`${s}\``).join(", ") : "none"}`,
    );
    lines.push("");
    lines.push("```text");
    for (const cmd of commandDetails) {
      lines.push(`${cmd.name.padEnd(24)} -> ${cmd.syntax}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("**Key Invariants**:");
    for (const inv of spec.invariants.slice(0, 5)) {
      lines.push(`- 🔴 ${inv}`);
    }
  } else {
    lines.push(`### 🛡️ Role Contract: \`${spec.name}\` (Tier ${spec.tier})`);
    lines.push(`**${spec.title}** — ${spec.summary}`);
    lines.push("");

    if (spec.domain !== undefined) {
      lines.push(`- **Specialization Domain**: \`${spec.domain}\``);
    }
    lines.push(`- **Authority Tier**: Tier ${spec.tier}`);
    lines.push(`- **Archetype**: \`${spec.archetype}\``);
    lines.push(`- **Write Scope Policy**: \`${spec.writeScopePolicy}\``);
    lines.push(
      `- **Spawns Allowed**: ${spec.spawns.length > 0 ? spec.spawns.map((s) => `\`${s}\``).join(", ") : "*(None — Leaf Worker)*"}`,
    );
    lines.push("");

    lines.push("#### ⚡ Granted CLI Verbs & Syntax");
    lines.push("| Command | Summary | Syntax Template |");
    lines.push("| :--- | :--- | :--- |");
    for (const cmd of commandDetails) {
      lines.push(`| \`${cmd.name}\` | ${cmd.summary} | \`${cmd.syntax}\` |`);
    }
    lines.push("");

    lines.push("#### 🚫 Invariants & Absolute Prohibitions (`must_not`)");
    for (const not of spec.prohibitedActions) {
      lines.push(`- 🔴 ${not}`);
    }
    lines.push("");

    lines.push("#### ✅ Permitted Activities (`may`)");
    for (const may of spec.permittedActivities) {
      lines.push(`- 🟢 ${may}`);
    }
    lines.push("");

    if (spec.cognitivePillars.length > 0) {
      lines.push("#### 🧠 Cognitive Pillars");
      for (const pillar of spec.cognitivePillars) {
        lines.push(`- 🔷 ${pillar}`);
      }
      lines.push("");
    }
  }

  const markdown = lines.join("\n");

  return {
    role: spec.name,
    tier: spec.tier,
    title: spec.title,
    summary: spec.summary,
    domain: spec.domain,
    grantedCommands: spec.grantedCommands,
    commandDetails,
    permittedActivities: spec.permittedActivities,
    forbiddenActions: spec.prohibitedActions,
    invariants: spec.invariants,
    authorityRules: [
      `Tier ${spec.tier} authority`,
      `Archetype: ${spec.archetype}`,
      `Write Policy: ${spec.writeScopePolicy}`,
    ],
    spawns: spec.spawns,
    cognitivePillars: spec.cognitivePillars,
    markdown,
  };
}

/**
 * Renders an ASCII table summary of dynamic roles.
 */
export function renderDynamicRolesAsciiTable(
  roles: readonly (DynamicRoleContract | DynamicRoleSpec)[],
): string {
  if (roles.length === 0) {
    return "(no dynamic roles registered)";
  }

  const rows = roles.map((r) => {
    const spec = "spec" in r ? r.spec : r;
    return {
      name: spec.name,
      tier: String(spec.tier),
      archetype: spec.archetype,
      commands: String(spec.grantedCommands.length),
      writePolicy: spec.writeScopePolicy,
      domain: spec.domain ?? "-",
    };
  });

  const colNameW = Math.max(4, ...rows.map((r) => r.name.length), "Role".length);
  const colTierW = Math.max(4, ...rows.map((r) => r.tier.length), "Tier".length);
  const colArchW = Math.max(9, ...rows.map((r) => r.archetype.length), "Archetype".length);
  const colCmdW = Math.max(8, ...rows.map((r) => r.commands.length), "Commands".length);
  const colPolicyW = Math.max(12, ...rows.map((r) => r.writePolicy.length), "Write Policy".length);
  const colDomainW = Math.max(6, ...rows.map((r) => r.domain.length), "Domain".length);

  const topBorder = `┌${"─".repeat(colNameW + 2)}┬${"─".repeat(colTierW + 2)}┬${"─".repeat(colArchW + 2)}┬${"─".repeat(colCmdW + 2)}┬${"─".repeat(colPolicyW + 2)}┬${"─".repeat(colDomainW + 2)}┐`;
  const header = `│ ${"Role".padEnd(colNameW)} │ ${"Tier".padEnd(colTierW)} │ ${"Archetype".padEnd(colArchW)} │ ${"Commands".padEnd(colCmdW)} │ ${"Write Policy".padEnd(colPolicyW)} │ ${"Domain".padEnd(colDomainW)} │`;
  const midBorder = `├${"─".repeat(colNameW + 2)}┼${"─".repeat(colTierW + 2)}┼${"─".repeat(colArchW + 2)}┼${"─".repeat(colCmdW + 2)}┼${"─".repeat(colPolicyW + 2)}┼${"─".repeat(colDomainW + 2)}┤`;
  const botBorder = `└${"─".repeat(colNameW + 2)}┴${"─".repeat(colTierW + 2)}┴${"─".repeat(colArchW + 2)}┴${"─".repeat(colCmdW + 2)}┴${"─".repeat(colPolicyW + 2)}┴${"─".repeat(colDomainW + 2)}┘`;

  const dataLines = rows.map((r) => {
    return `│ ${r.name.padEnd(colNameW)} │ ${r.tier.padEnd(colTierW)} │ ${r.archetype.padEnd(colArchW)} │ ${r.commands.padEnd(colCmdW)} │ ${r.writePolicy.padEnd(colPolicyW)} │ ${r.domain.padEnd(colDomainW)} │`;
  });

  return [topBorder, header, midBorder, ...dataLines, botBorder].join("\n");
}

/**
 * In-memory registry catalog for managing dynamic synthesized roles.
 */
export class DynamicRoleRegistry {
  private readonly roles = new Map<string, DynamicRoleContract>();

  public register(roleOrSpec: DynamicRoleContract | DynamicRoleSpec): DynamicRoleContract {
    const contract: DynamicRoleContract =
      "spec" in roleOrSpec
        ? roleOrSpec
        : synthesizeDynamicRole({
            name: roleOrSpec.name,
            archetype: roleOrSpec.archetype,
            tier: roleOrSpec.tier,
            title: roleOrSpec.title,
            summary: roleOrSpec.summary,
            domain: roleOrSpec.domain,
            grantedCommands: roleOrSpec.grantedCommands,
            permittedActivities: roleOrSpec.permittedActivities,
            prohibitedActions: roleOrSpec.prohibitedActions,
            invariants: roleOrSpec.invariants,
            spawns: roleOrSpec.spawns,
            cognitivePillars: roleOrSpec.cognitivePillars,
            writeScopePolicy: roleOrSpec.writeScopePolicy,
            version: roleOrSpec.version,
            parentRole: roleOrSpec.parentRole,
            metadata: roleOrSpec.metadata,
          });

    this.roles.set(contract.role, contract);
    return contract;
  }

  public get(name: string): DynamicRoleContract | undefined {
    return this.roles.get(name);
  }

  public has(name: string): boolean {
    return this.roles.has(name);
  }

  public revoke(name: string): boolean {
    return this.roles.delete(name);
  }

  public count(): number {
    return this.roles.size;
  }

  public clear(): void {
    this.roles.clear();
  }

  public list(filter?: DynamicRoleFilter): readonly DynamicRoleContract[] {
    let list = Array.from(this.roles.values());

    if (filter?.tier !== undefined) {
      list = list.filter((r) => r.tier === filter.tier);
    }
    if (filter?.domain !== undefined) {
      list = list.filter((r) => r.domain === filter.domain);
    }
    if (filter?.archetype !== undefined) {
      list = list.filter((r) => r.spec.archetype === filter.archetype);
    }
    if (filter?.writeScopePolicy !== undefined) {
      list = list.filter((r) => r.writeScopePolicy === filter.writeScopePolicy);
    }

    return list.sort((a, b) => a.role.localeCompare(b.role));
  }

  public filterByTier(tier: number): readonly DynamicRoleContract[] {
    return this.list({ tier });
  }

  public filterByDomain(domain: string): readonly DynamicRoleContract[] {
    return this.list({ domain });
  }

  public filterByArchetype(archetype: RoleArchetype): readonly DynamicRoleContract[] {
    return this.list({ archetype });
  }

  public exportCatalog(): DynamicRoleCatalogExport {
    const allRoles = this.list().map((r) => r.spec);
    return {
      exportedAt: new Date().toISOString(),
      totalRoles: allRoles.length,
      roles: allRoles,
    };
  }

  public importCatalog(catalog: DynamicRoleCatalogExport): number {
    let imported = 0;
    for (const spec of catalog.roles) {
      this.register(spec);
      imported++;
    }
    return imported;
  }

  public renderAsciiTable(): string {
    return renderDynamicRolesAsciiTable(this.list());
  }
}

/**
 * Global singleton dynamic role registry instance.
 */
let globalRegistryInstance: DynamicRoleRegistry | null = null;

export function getGlobalRoleRegistry(): DynamicRoleRegistry {
  if (!globalRegistryInstance) {
    globalRegistryInstance = new DynamicRoleRegistry();
  }
  return globalRegistryInstance;
}

export function resetGlobalRoleRegistry(): void {
  if (globalRegistryInstance) {
    globalRegistryInstance.clear();
  }
  globalRegistryInstance = null;
}

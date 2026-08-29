import { formatDynamicRoleBody } from "./validation.ts";
import {
  ARCHETYPE_DEFAULT_COMMANDS,
  ARCHETYPE_DEFAULT_SPAWNS,
  ARCHETYPE_DEFAULT_WRITE_POLICY,
} from "./types.ts";
import { ARCHETYPE_TIER_MAP } from "./types.ts";
import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import type { DynamicRoleSpec, DynamicRoleContract, SynthesizeRoleOptions } from "./types.ts";
import { validateDynamicRoleSpec, formatDynamicRoleFrontmatter } from "./validation.ts";
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

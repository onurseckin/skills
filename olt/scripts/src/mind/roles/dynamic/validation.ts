import { HarnessError } from "../../../core/errors/index.ts";
import { buildCommandCheatSheet } from "../../../roles/index.ts";
import {
  ARCHETYPE_DEFAULT_COMMANDS,
  ARCHETYPE_DEFAULT_SPAWNS,
  ARCHETYPE_DEFAULT_WRITE_POLICY,
  ARCHETYPE_TIER_MAP,
  FORBIDDEN_COMMANDS,
  ROLE_NAME_PATTERN,
} from "./types.ts";
import type { DynamicRoleSpec, DynamicRoleValidationResult } from "./types.ts";

export { buildCommandCheatSheet };

export function validateDynamicRoleSpec(spec: DynamicRoleSpec): DynamicRoleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!spec.name || typeof spec.name !== "string" || !ROLE_NAME_PATTERN.test(spec.name)) {
    errors.push(`Role name '${spec.name}' is invalid. Must match pattern ^[a-z][a-z0-9_-]*$.`);
  }

  if (!Number.isSafeInteger(spec.tier) || spec.tier < 0 || spec.tier > 3) {
    errors.push(`Tier must be an integer between 0 and 3, got: ${spec.tier}.`);
  }

  const expectedTier = ARCHETYPE_TIER_MAP[spec.archetype];
  if (expectedTier !== undefined && spec.tier !== expectedTier) {
    errors.push(
      `Archetype '${spec.archetype}' expects Tier ${expectedTier}, but specification assigned Tier ${spec.tier}.`,
    );
  }

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

  for (const cmd of spec.grantedCommands) {
    if (FORBIDDEN_COMMANDS.has(cmd)) {
      errors.push(`Command '${cmd}' is strictly forbidden across all role specifications.`);
    }
  }

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

export function formatDynamicRoleMarkdown(spec: DynamicRoleSpec): string {
  const frontmatter = formatDynamicRoleFrontmatter(spec);
  const body = formatDynamicRoleBody(spec);
  return `${frontmatter}\n\n${body}\n`;
}

export function assertValidDynamicRoleSpec(spec: DynamicRoleSpec): void {
  const res = validateDynamicRoleSpec(spec);
  if (!res.valid) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Invalid dynamic role spec '${spec.name}': ${res.errors.join("; ")}`,
      res.errors,
    );
  }
}

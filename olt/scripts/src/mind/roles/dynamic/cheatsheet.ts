import { buildCommandCheatSheet } from "./validation.ts";
import type {
  DynamicRoleSpec,
  DynamicRoleContract,
  RoleCheatSheetOptions,
  RoleCheatSheet,
} from "./types.ts";

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

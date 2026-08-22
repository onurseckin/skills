import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findCommand } from "../cli/registry/index.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  parseRoleContract as parseBaseRoleContract,
  type RoleContract as BaseRoleContract,
} from "../packets/role-contract.ts";

const DEFAULT_ROLES_ROOT = fileURLToPath(new URL("../../../roles", import.meta.url));

export interface RoleCheatSheetOptions {
  readonly compact?: boolean | undefined;
  readonly rolesDir?: string | undefined;
}

export interface RoleCommandCheatSheet {
  readonly name: string;
  readonly summary: string;
  readonly syntax: string;
  readonly requiredFlags: readonly string[];
  readonly optionalFlags: readonly string[];
  readonly examples: readonly string[];
}

export interface RoleCheatSheet {
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly grantedCommands: readonly string[];
  readonly commandDetails: readonly RoleCommandCheatSheet[];
  readonly permittedActivities: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly invariants: readonly string[];
  readonly authorityRules: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars?: readonly string[] | undefined;
  readonly markdown: string;
}

export interface RoleSummary {
  readonly role: string;
  readonly tier: number;
  readonly commandCount: number;
  readonly spawnsCount: number;
  readonly spawns: readonly string[];
  readonly invariantsCount: number;
  readonly domain?: string | undefined;
}

export function parseRoleContract(
  content: Uint8Array | string,
  source = "contract.md",
): BaseRoleContract {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return parseBaseRoleContract(bytes, source);
}

export function listAvailableRoles(rolesDir?: string | undefined): readonly string[] {
  const dir = rolesDir !== undefined ? resolve(rolesDir) : DEFAULT_ROLES_ROOT;
  if (!existsSync(dir)) {
    throw new HarnessError("PATH_SAFETY", `roles directory does not exist: ${dir}`);
  }
  const entries = readdirSync(dir);
  const roles = entries
    .filter((entry) => entry.endsWith(".md") && !entry.startsWith("."))
    .map((entry) => entry.slice(0, -3))
    .sort();
  return roles;
}

function resolveRoleFile(role: string, rolesDir?: string | undefined): string {
  const dir = rolesDir !== undefined ? resolve(rolesDir) : DEFAULT_ROLES_ROOT;
  const fileName = role.endsWith(".md") ? role : `${role}.md`;
  const fullPath = join(dir, fileName);
  if (!existsSync(fullPath)) {
    throw new HarnessError("INVALID_ARGUMENT", `role contract not found for role '${role}' at ${fullPath}`);
  }
  return fullPath;
}

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

function extractProseDetails(body: string): {
  title: string;
  summary: string;
  cognitivePillars: string[];
  proseRules: string[];
} {
  const lines = body.split("\n");
  let title = "Role";
  let summary = "";
  const cognitivePillars: string[] = [];
  const proseRules: string[] = [];

  let inPillars = false;
  const leadParagraphs: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ") && title === "Role") {
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
    if (trimmed.startsWith("- **")) {
      proseRules.push(trimmed.slice(2).trim());
      continue;
    }
    if (!trimmed.startsWith("#") && !trimmed.startsWith("-") && trimmed.length > 0 && leadParagraphs.length < 2) {
      leadParagraphs.push(trimmed);
    }
  }

  summary = leadParagraphs.join(" ");
  return { title, summary, cognitivePillars, proseRules };
}

function formatFullMarkdownCheatSheet(sheet: Omit<RoleCheatSheet, "markdown">): string {
  const lines: string[] = [];
  lines.push(`### 🛡️ Role Contract: \`${sheet.role}\` (Tier ${sheet.tier})`);
  lines.push(`**${sheet.title}** — ${sheet.summary}`);
  lines.push("");

  if (sheet.domain !== undefined) {
    lines.push(`- **Validator Domain**: \`${sheet.domain}\``);
  }
  lines.push(`- **Authority Tier**: Tier ${sheet.tier}`);
  lines.push(`- **Spawns Allowed**: ${sheet.spawns.length > 0 ? sheet.spawns.map((s) => `\`${s}\``).join(", ") : "*(None — Leaf Worker)*"}`);
  lines.push("");

  lines.push("#### ⚡ Granted CLI Verbs & Syntax");
  lines.push("| Command | Summary | Syntax Template |");
  lines.push("| :--- | :--- | :--- |");
  for (const cmd of sheet.commandDetails) {
    lines.push(`| \`${cmd.name}\` | ${cmd.summary} | \`${cmd.syntax}\` |`);
  }
  lines.push("");

  lines.push("#### 🚫 Invariants & Absolute Prohibitions (`must_not`)");
  for (const inv of sheet.invariants) {
    lines.push(`- 🔴 ${inv}`);
  }
  lines.push("");

  lines.push("#### ✅ Permitted Activities (`may`)");
  for (const may of sheet.permittedActivities) {
    lines.push(`- 🟢 ${may}`);
  }
  lines.push("");

  if (sheet.cognitivePillars !== undefined && sheet.cognitivePillars.length > 0) {
    lines.push("#### 🧠 Cognitive Pillars");
    for (const pillar of sheet.cognitivePillars) {
      lines.push(`- 🔷 ${pillar}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatCompactMarkdownCheatSheet(sheet: Omit<RoleCheatSheet, "markdown">): string {
  const lines: string[] = [];
  lines.push(`### ⚡ Compact Cheat-Sheet: \`${sheet.role}\` (Tier ${sheet.tier})`);
  lines.push(`**Granted Commands (${sheet.grantedCommands.length})**: ${sheet.grantedCommands.map((c) => `\`${c}\``).join(", ")}`);
  lines.push(`**Spawns (${sheet.spawns.length})**: ${sheet.spawns.length > 0 ? sheet.spawns.map((s) => `\`${s}\``).join(", ") : "none"}`);
  lines.push("");
  lines.push("```text");
  for (const cmd of sheet.commandDetails) {
    lines.push(`${cmd.name.padEnd(22)} -> ${cmd.syntax}`);
  }
  lines.push("```");
  lines.push("");
  lines.push("**Key Invariants**:");
  for (const inv of sheet.invariants.slice(0, 5)) {
    lines.push(`- 🔴 ${inv}`);
  }
  if (sheet.invariants.length > 5) {
    lines.push(`- *(+${sheet.invariants.length - 5} more prohibitions in full contract)*`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generateRoleCheatSheet(
  role: string,
  options?: RoleCheatSheetOptions | undefined,
): RoleCheatSheet {
  const filePath = resolveRoleFile(role, options?.rolesDir);
  const bytes = readRegularFileNoFollow(filePath);
  const contract = parseBaseRoleContract(bytes, basename(filePath));

  const body = contract.text.slice(contract.text.indexOf("---", 3) + 3).trim();
  const prose = extractProseDetails(body);

  const commandDetails = contract.commands.map(buildCommandCheatSheet);
  const invariants = [...contract.must_not];
  const authorityRules = [
    `Tier ${contract.tier} execution authority`,
    `Spawns: ${contract.spawns.length > 0 ? contract.spawns.join(", ") : "none"}`,
    ...prose.proseRules,
  ];

  const baseSheet = {
    role: contract.role,
    tier: contract.tier,
    title: prose.title.length > 0 && prose.title !== "Role" ? prose.title : contract.role,
    summary: prose.summary.length > 0 ? prose.summary : `Role contract for ${contract.role}`,
    domain: contract.domain,
    grantedCommands: contract.commands,
    commandDetails,
    permittedActivities: contract.may,
    forbiddenActions: contract.must_not,
    invariants,
    authorityRules,
    spawns: contract.spawns,
    ...(prose.cognitivePillars.length > 0 ? { cognitivePillars: prose.cognitivePillars } : {}),
  };

  const markdown = options?.compact
    ? formatCompactMarkdownCheatSheet(baseSheet)
    : formatFullMarkdownCheatSheet(baseSheet);

  return {
    ...baseSheet,
    markdown,
  };
}

export function renderAsciiRoleTable(
  roles: readonly (RoleSummary | RoleCheatSheet)[],
): string {
  if (roles.length === 0) {
    return "(no roles found)";
  }

  const rows = roles.map((r) => {
    const roleName = r.role;
    const tierStr = String(r.tier);
    const cmdCount = "commandCount" in r ? String(r.commandCount) : String(r.grantedCommands.length);
    const spawnsList = r.spawns.length > 0 ? r.spawns.join(", ") : "(none)";
    const invCount =
      "invariantsCount" in r ? String(r.invariantsCount) : String(r.invariants.length);

    return {
      role: roleName,
      tier: tierStr,
      commands: cmdCount,
      spawns: spawnsList,
      invariants: invCount,
    };
  });

  const colRoleWidth = Math.max(4, ...rows.map((r) => r.role.length), "Role".length);
  const colTierWidth = Math.max(4, ...rows.map((r) => r.tier.length), "Tier".length);
  const colCmdWidth = Math.max(8, ...rows.map((r) => r.commands.length), "Commands".length);
  const colSpawnsWidth = Math.min(
    32,
    Math.max(6, ...rows.map((r) => r.spawns.length), "Spawns".length),
  );
  const colInvWidth = Math.max(10, ...rows.map((r) => r.invariants.length), "Invariants".length);

  const topBorder = `┌${"─".repeat(colRoleWidth + 2)}┬${"─".repeat(colTierWidth + 2)}┬${"─".repeat(colCmdWidth + 2)}┬${"─".repeat(colSpawnsWidth + 2)}┬${"─".repeat(colInvWidth + 2)}┐`;
  const header = `│ ${"Role".padEnd(colRoleWidth)} │ ${"Tier".padEnd(colTierWidth)} │ ${"Commands".padEnd(colCmdWidth)} │ ${"Spawns".padEnd(colSpawnsWidth)} │ ${"Invariants".padEnd(colInvWidth)} │`;
  const midBorder = `├${"─".repeat(colRoleWidth + 2)}┼${"─".repeat(colTierWidth + 2)}┼${"─".repeat(colCmdWidth + 2)}┼${"─".repeat(colSpawnsWidth + 2)}┼${"─".repeat(colInvWidth + 2)}┤`;
  const botBorder = `└${"─".repeat(colRoleWidth + 2)}┴${"─".repeat(colTierWidth + 2)}┴${"─".repeat(colCmdWidth + 2)}┴${"─".repeat(colSpawnsWidth + 2)}┴${"─".repeat(colInvWidth + 2)}┘`;

  const dataLines = rows.map((r) => {
    const spawnsTruncated =
      r.spawns.length > colSpawnsWidth
        ? `${r.spawns.slice(0, colSpawnsWidth - 3)}...`
        : r.spawns;
    return `│ ${r.role.padEnd(colRoleWidth)} │ ${r.tier.padEnd(colTierWidth)} │ ${r.commands.padEnd(colCmdWidth)} │ ${spawnsTruncated.padEnd(colSpawnsWidth)} │ ${r.invariants.padEnd(colInvWidth)} │`;
  });

  return [topBorder, header, midBorder, ...dataLines, botBorder].join("\n");
}

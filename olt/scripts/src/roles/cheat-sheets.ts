import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../core/errors/index.ts";
import { isAgentRole } from "../core/contracts/index.ts";
import {
  loadRoleContract,
  loadValidatorDomainContract,
  parseRoleContract as parseBaseRoleContract,
  type RoleContract as BaseRoleContract,
  type ValidatorDomain,
} from "../packets/role-contract.ts";
import { buildCommandCheatSheet } from "./syntax.ts";
import type { RoleCheatSheet, RoleCheatSheetOptions, UniversalRoleSpec } from "./types.ts";

export { renderAsciiRoleTable } from "./ascii-table.ts";

const DEFAULT_AGENTS_ROOT = fileURLToPath(new URL("../../../agents", import.meta.url));

export function parseRoleContract(
  content: Uint8Array | string,
  source = "contract.md",
): BaseRoleContract {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return parseBaseRoleContract(bytes, source);
}

export function listAvailableRoles(rolesDir?: string | undefined): readonly string[] {
  const dir = rolesDir !== undefined ? resolve(rolesDir) : DEFAULT_AGENTS_ROOT;
  if (!existsSync(dir))
    throw new HarnessError("PATH_SAFETY", `roles directory does not exist: ${dir}`);
  const roles = readdirSync(dir)
    .filter((e) => {
      const isExt = e.endsWith(".yaml") ? true : e.endsWith(".yml") ? true : e.endsWith(".md");
      return isExt && !e.startsWith(".");
    })
    .map((e) => e.replace(/\.(yaml|yml|md)$/, ""))
    .filter((e) => (rolesDir !== undefined ? true : isAgentRole(e)))
    .sort();
  if (roles.includes("validator") && !roles.includes("validator-code-quality")) {
    roles.push(
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
    );
    roles.sort();
  }
  return roles;
}

function resolveRoleFile(role: string, rolesDir?: string | undefined): string {
  const dir = rolesDir !== undefined ? resolve(rolesDir) : DEFAULT_AGENTS_ROOT;
  const candidates = [
    join(dir, `${role}.yaml`),
    join(dir, `${role}.yml`),
    join(dir, `${role}.md`),
    join(dir, role),
  ];
  if (role.startsWith("validator-"))
    candidates.push(
      join(dir, "validator.yaml"),
      join(dir, "validator.yml"),
      join(dir, "validator.md"),
    );
  for (const cand of candidates) {
    if (existsSync(cand)) return cand;
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `role contract not found for role '${role}' at ${join(dir, role)}`,
  );
}

function extractProseDetails(body: string): {
  title: string;
  summary: string;
  cognitivePillars: string[];
  proseRules: string[];
} {
  let title = "Role";
  const cognitivePillars: string[] = [];
  const proseRules: string[] = [];
  let inPillars = false;
  const leadParagraphs: string[] = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ") && title === "Role") {
      const heading = trimmed.slice(2).trim();
      if (
        !heading.toLowerCase().includes("host-tool") &&
        !heading.toLowerCase().includes("interlock")
      ) {
        title = heading;
      }
      continue;
    }
    if (trimmed.startsWith("## Cognitive Pillars")) {
      inPillars = true;
      continue;
    }
    if (inPillars && trimmed.startsWith("## ")) inPillars = false;
    if (inPillars && trimmed.startsWith("- ")) {
      cognitivePillars.push(trimmed.slice(2).trim());
      continue;
    }
    if (trimmed.startsWith("- **")) {
      proseRules.push(trimmed.slice(2).trim());
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
  return { title, summary: leadParagraphs.join(" "), cognitivePillars, proseRules };
}

function formatCompactMarkdown(sheet: Omit<RoleCheatSheet, "markdown">): string {
  const lines: string[] = [
    `### ⚡ Compact Cheat-Sheet: \`${sheet.role}\` (Tier ${sheet.tier})`,
    `**Granted Commands (${sheet.grantedCommands.length})**: ${sheet.grantedCommands.map((c) => `\`${c}\``).join(", ")}`,
    `**Spawns (${sheet.spawns.length})**: ${sheet.spawns.length > 0 ? sheet.spawns.map((s) => `\`${s}\``).join(", ") : "none"}`,
    "",
    "```text",
    ...sheet.commandDetails.map((cmd) => `${cmd.name.padEnd(22)} -> ${cmd.syntax}`),
    "```",
    "",
    "**Key Invariants**:",
  ];
  const invList = sheet.invariants.length > 0 ? sheet.invariants : sheet.forbiddenActions;
  for (const inv of invList.slice(0, 5)) lines.push(`- 🔴 ${inv}`);
  if (invList.length > 5)
    lines.push(`- *(+${invList.length - 5} more prohibitions in full contract)*`);
  lines.push("");
  return lines.join("\n");
}

function formatFullMarkdown(
  sheet: Omit<RoleCheatSheet, "markdown">,
  spec: UniversalRoleSpec,
): string {
  const lines: string[] = [
    `### 🛡️ Role Contract: \`${sheet.role}\` (Tier ${sheet.tier})`,
    `**${sheet.title}** — ${sheet.summary}`,
    "",
  ];
  if (sheet.domain !== undefined) {
    const domainLabel = spec.archetype !== undefined ? "Specialization Domain" : "Validator Domain";
    lines.push(`- **${domainLabel}**: \`${sheet.domain}\``);
  }
  lines.push(`- **Authority Tier**: Tier ${sheet.tier}`);
  if (spec.archetype !== undefined) lines.push(`- **Archetype**: \`${spec.archetype}\``);
  if (spec.writeScopePolicy !== undefined)
    lines.push(`- **Write Scope Policy**: \`${spec.writeScopePolicy}\``);
  lines.push(
    `- **Spawns Allowed**: ${sheet.spawns.length > 0 ? sheet.spawns.map((s) => `\`${s}\``).join(", ") : "*(None — Leaf Worker)*"}`,
  );
  lines.push(
    "",
    "#### ⚡ Granted CLI Verbs & Syntax",
    "| Command | Summary | Syntax Template |",
    "| :--- | :--- | :--- |",
  );
  for (const cmd of sheet.commandDetails)
    lines.push(`| \`${cmd.name}\` | ${cmd.summary} | \`${cmd.syntax}\` |`);
  lines.push("", "#### 🚫 Invariants & Absolute Prohibitions (`must_not`)");
  const prohibitedItems =
    sheet.forbiddenActions.length > 0 ? sheet.forbiddenActions : sheet.invariants;
  for (const inv of prohibitedItems) lines.push(`- 🔴 ${inv}`);
  lines.push("", "#### ✅ Permitted Activities (`may`)");
  for (const may of sheet.permittedActivities) lines.push(`- 🟢 ${may}`);
  lines.push("");
  if (sheet.cognitivePillars !== undefined && sheet.cognitivePillars.length > 0) {
    lines.push("#### 🧠 Cognitive Pillars");
    for (const pillar of sheet.cognitivePillars) lines.push(`- 🔷 ${pillar}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function formatUniversalCheatSheet(
  spec: UniversalRoleSpec,
  options?: RoleCheatSheetOptions | undefined,
): RoleCheatSheet {
  const commandDetails = spec.grantedCommands.map(buildCommandCheatSheet);
  let forbiddenActions: readonly string[] = [];
  if (spec.prohibitedActions !== undefined) {
    forbiddenActions = spec.prohibitedActions;
  } else if (spec.forbiddenActions !== undefined) {
    forbiddenActions = spec.forbiddenActions;
  }
  const invariants = [...spec.invariants];
  let authorityRules = spec.authorityRules;
  if (authorityRules === undefined) {
    authorityRules = [
      `Tier ${spec.tier} authority`,
      ...(spec.archetype !== undefined ? [`Archetype: ${spec.archetype}`] : []),
      ...(spec.writeScopePolicy !== undefined ? [`Write Policy: ${spec.writeScopePolicy}`] : []),
    ];
  }

  const baseSheet: Omit<RoleCheatSheet, "markdown"> = {
    role: spec.name,
    tier: spec.tier,
    title: spec.title,
    summary: spec.summary,
    domain: spec.domain,
    grantedCommands: spec.grantedCommands,
    commandDetails,
    permittedActivities: spec.permittedActivities,
    forbiddenActions,
    invariants,
    authorityRules,
    spawns: spec.spawns,
    ...(spec.cognitivePillars && spec.cognitivePillars.length > 0
      ? { cognitivePillars: spec.cognitivePillars }
      : {}),
  };

  const markdown = options?.compact
    ? formatCompactMarkdown(baseSheet)
    : formatFullMarkdown(baseSheet, spec);
  return { ...baseSheet, markdown };
}

export function generateRoleCheatSheet(
  role: string,
  options?: RoleCheatSheetOptions | undefined,
): RoleCheatSheet {
  let chosenDir = options?.rolesDir;
  if (chosenDir === undefined) {
    chosenDir = options?.agentsDir;
  }
  const filePath = resolveRoleFile(role, chosenDir);
  const bytes = readRegularFileNoFollow(filePath);
  const rawText = new TextDecoder("utf-8").decode(bytes);
  let contract: BaseRoleContract;
  let body: string;

  if (rawText.trimStart().startsWith("---")) {
    contract = parseBaseRoleContract(bytes, basename(filePath));
    body = contract.text.slice(contract.text.indexOf("---", 3) + 3).trim();
  } else if (role.startsWith("validator-")) {
    const domain = role.slice("validator-".length) as ValidatorDomain;
    contract = loadValidatorDomainContract(domain);
    body = contract.text;
  } else {
    contract = loadRoleContract(role as Parameters<typeof loadRoleContract>[0]);
    body = contract.text;
  }

  const prose = extractProseDetails(body);
  const invariants = [...contract.must_not];
  const antiLeakRules: string[] = [];

  const isTargetRole =
    contract.role === "validator" ? true : contract.role === "completeness-critic";
  if (
    isTargetRole &&
    !prose.proseRules.some((r) => r.toLowerCase().includes("anti-boundary-leak"))
  ) {
    const rule =
      "**Anti-Boundary-Leak Rule**: Strictly prohibited from claiming code write leases or editing source files; failures must be recorded via findings and delegated to an assigned repairer.";
    antiLeakRules.push(rule);
    if (!invariants.some((i) => i.toLowerCase().includes("anti-boundary-leak"))) {
      invariants.push(
        "Anti-Boundary-Leak Rule: Strictly prohibited from claiming code write leases or editing source files; failures must be recorded via findings and delegated to an assigned repairer.",
      );
    }
  }

  const authorityRules = [
    `Tier ${contract.tier} execution authority`,
    `Spawns: ${contract.spawns.length > 0 ? contract.spawns.join(", ") : "none"}`,
    ...antiLeakRules,
    ...prose.proseRules,
  ];

  const spec: UniversalRoleSpec = {
    name: contract.role,
    tier: contract.tier,
    title:
      prose.title.length > 0 && prose.title !== "Role"
        ? prose.title
        : contract.role.charAt(0).toUpperCase() + contract.role.slice(1),
    summary: prose.summary.length > 0 ? prose.summary : `Role contract for ${contract.role}`,
    domain: contract.domain,
    grantedCommands: contract.commands,
    permittedActivities: contract.may,
    prohibitedActions: invariants,
    forbiddenActions: contract.must_not,
    invariants,
    authorityRules,
    spawns: contract.spawns,
    ...(prose.cognitivePillars.length > 0 ? { cognitivePillars: prose.cognitivePillars } : {}),
  };

  return formatUniversalCheatSheet(spec, options);
}

import { existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentRole } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
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

export function listAvailableRoles(rolesDir?: string): readonly string[] {
  const dir = rolesDir !== undefined ? resolve(rolesDir) : DEFAULT_AGENTS_ROOT;
  if (!existsSync(dir))
    throw new HarnessError("PATH_SAFETY", `roles directory does not exist: ${dir}`);
  const roles = readdirSync(dir)
    .filter(
      (e) => (e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".md")) && !e.startsWith("."),
    )
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

function resolveRoleFile(role: string, rolesDir?: string): string {
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

function extractProseDetails(
  body: string,
  roleName: string,
): {
  title: string;
  summary: string;
  cognitivePillars: string[];
  proseRules: string[];
} {
  let title = "Role",
    inPillars = false;
  const cognitivePillars: string[] = [],
    proseRules: string[] = [],
    leadParagraphs: string[] = [];
  const normalizedRole = roleName.toLowerCase().replace(/^validator-/, "");
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ") && title === "Role") {
      const h = trimmed.slice(2).trim(),
        hl = h.toLowerCase();
      if (
        hl === normalizedRole ||
        hl === roleName.toLowerCase() ||
        hl.startsWith(normalizedRole) ||
        (!hl.includes("host-tool") &&
          !hl.includes("interlock") &&
          !hl.includes("guard") &&
          !hl.includes("mandate") &&
          !hl.includes("verification") &&
          !hl.includes("shielded"))
      ) {
        title = h;
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
  const invList = sheet.invariants.length > 0 ? sheet.invariants : sheet.forbiddenActions;
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
    ...invList.slice(0, 5).map((inv) => `- 🔴 ${inv}`),
    ...(invList.length > 5
      ? [`- *(+${invList.length - 5} more prohibitions in full contract)*`]
      : []),
    "",
  ];
  return lines.join("\n");
}

function formatFullMarkdown(
  sheet: Omit<RoleCheatSheet, "markdown">,
  spec: UniversalRoleSpec,
): string {
  const prohibited = sheet.forbiddenActions.length > 0 ? sheet.forbiddenActions : sheet.invariants;
  const lines: string[] = [
    `### 🛡️ Role Contract: \`${sheet.role}\` (Tier ${sheet.tier})`,
    `**${sheet.title}** — ${sheet.summary}`,
    "",
    ...(sheet.domain !== undefined
      ? [
          `- **${spec.archetype !== undefined ? "Specialization Domain" : "Validator Domain"}**: \`${sheet.domain}\``,
        ]
      : []),
    `- **Authority Tier**: Tier ${sheet.tier}`,
    ...(spec.archetype !== undefined ? [`- **Archetype**: \`${spec.archetype}\``] : []),
    ...(spec.writeScopePolicy !== undefined
      ? [`- **Write Scope Policy**: \`${spec.writeScopePolicy}\``]
      : []),
    `- **Spawns Allowed**: ${sheet.spawns.length > 0 ? sheet.spawns.map((s) => `\`${s}\``).join(", ") : "*(None — Leaf Worker)*"}`,
    "",
    "#### ⚡ Granted CLI Verbs & Syntax",
    "| Command | Summary | Syntax Template |",
    "| :--- | :--- | :--- |",
    ...sheet.commandDetails.map(
      (cmd) => `| \`${cmd.name}\` | ${cmd.summary} | \`${cmd.syntax}\` |`,
    ),
    "",
    "#### 🚫 Invariants & Absolute Prohibitions (`must_not`)",
    ...prohibited.map((inv) => `- 🔴 ${inv}`),
    "",
    "#### ✅ Permitted Activities (`may`)",
    ...sheet.permittedActivities.map((may) => `- 🟢 ${may}`),
    "",
    ...(sheet.cognitivePillars && sheet.cognitivePillars.length > 0
      ? ["#### 🧠 Cognitive Pillars", ...sheet.cognitivePillars.map((p) => `- 🔷 ${p}`), ""]
      : []),
  ];
  return lines.join("\n");
}

export function formatUniversalCheatSheet(
  spec: UniversalRoleSpec,
  options?: RoleCheatSheetOptions,
): RoleCheatSheet {
  const commandDetails = spec.grantedCommands.map(buildCommandCheatSheet);
  const baseSheet: Omit<RoleCheatSheet, "markdown"> = {
    role: spec.name,
    tier: spec.tier,
    title: spec.title,
    summary: spec.summary,
    domain: spec.domain,
    grantedCommands: spec.grantedCommands,
    commandDetails,
    permittedActivities: spec.permittedActivities,
    forbiddenActions: spec.prohibitedActions ?? spec.forbiddenActions ?? [],
    invariants: [...spec.invariants],
    authorityRules: spec.authorityRules ?? [
      `Tier ${spec.tier} authority`,
      ...(spec.archetype !== undefined ? [`Archetype: ${spec.archetype}`] : []),
      ...(spec.writeScopePolicy !== undefined ? [`Write Policy: ${spec.writeScopePolicy}`] : []),
    ],
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
  options?: RoleCheatSheetOptions,
): RoleCheatSheet {
  const filePath = resolveRoleFile(role, options?.rolesDir ?? options?.agentsDir);
  const bytes = readRegularFileNoFollow(filePath);
  const rawText = new TextDecoder("utf-8").decode(bytes);
  let contract: BaseRoleContract;
  let body: string;

  if (rawText.trimStart().startsWith("---")) {
    contract = parseBaseRoleContract(bytes, basename(filePath));
    body = contract.text.slice(contract.text.indexOf("---", 3) + 3).trim();
  } else if (role.startsWith("validator-")) {
    contract = loadValidatorDomainContract(role.slice("validator-".length) as ValidatorDomain);
    body = contract.text;
  } else {
    contract = loadRoleContract(role as Parameters<typeof loadRoleContract>[0]);
    body = contract.text;
  }

  const prose = extractProseDetails(body, role);
  const invariants = [...contract.must_not];
  const antiLeakRules: string[] = [];
  if (
    (contract.role === "validator" || contract.role === "completeness-critic") &&
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
    authorityRules: [
      `Tier ${contract.tier} execution authority`,
      `Spawns: ${contract.spawns.length > 0 ? contract.spawns.join(", ") : "none"}`,
      ...antiLeakRules,
      ...prose.proseRules,
    ],
    spawns: contract.spawns,
    ...(prose.cognitivePillars.length > 0 ? { cognitivePillars: prose.cognitivePillars } : {}),
  };

  return formatUniversalCheatSheet(spec, options);
}

import {
  ABSTRACT_PROFILES,
  ROLE_PROFILE_MAP,
  generateRoleCheatSheet,
  listAvailableRoles,
  renderAsciiRoleTable,
  resolveAgentProfile,
  resolveProfile,
  type AbstractProfile,
  type RoleCheatSheet,
  type RoleCheatSheetOptions,
  type RoleSummary,
} from "../../roles/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export function roleListCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const rolesDir = textFlag(flags, "roles-dir", false) ?? textFlag(flags, "dir", false);
  const roles = listAvailableRoles(rolesDir);

  return {
    roles,
    total: roles.length,
  };
}

export function roleProfileCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const role = textFlag(flags, "role", false);
  const profile = textFlag(flags, "profile", false);
  const rawHost = textFlag(flags, "host", false);
  const host = rawHost !== undefined ? rawHost : "local";

  if (role !== undefined) {
    const resolution = resolveAgentProfile(role, host);
    return {
      role,
      profile: resolution.profile,
      supportedOnHost: resolution.supportedOnHost,
      limitation: resolution.limitation,
      resolution,
    };
  }

  if (profile !== undefined) {
    const resolved = resolveProfile(profile as AbstractProfile);
    return {
      profile,
      resolved,
      bound: resolved.bound,
      model: resolved.model,
      model_tier: resolved.model_tier,
      thinking_level: resolved.thinking_level,
    };
  }

  return {
    abstractProfiles: ABSTRACT_PROFILES,
    roleProfileMap: ROLE_PROFILE_MAP,
  };
}

export async function roleCheatSheetCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const role = textFlag(flags, "role", false);
  const rolesDir = textFlag(flags, "roles-dir", false);
  const all = boolFlag(flags, "all");
  const compact = boolFlag(flags, "compact");

  const options: RoleCheatSheetOptions = {
    compact,
    ...(rolesDir !== undefined ? { rolesDir } : {}),
  };

  if (role !== undefined) {
    const sheet = generateRoleCheatSheet(role, options);
    return {
      markdown: sheet.markdown,
      role: sheet.role,
      tier: sheet.tier,
      title: sheet.title,
      summary: sheet.summary,
      domain: sheet.domain,
      cheat_sheet: sheet,
    };
  }

  const roleNames = listAvailableRoles(rolesDir);

  if (all) {
    const sheets: RoleCheatSheet[] = roleNames.map((r) => generateRoleCheatSheet(r, options));
    const table = renderAsciiRoleTable(sheets);
    const markdown = [
      "### 🛡️ System Role Catalog & Cheat Sheets",
      `Total registered roles: **${sheets.length}**`,
      "",
      table,
      "",
      ...sheets.map((s) => s.markdown),
    ].join("\n");

    return {
      markdown,
      total_roles: sheets.length,
      table,
      roles: sheets,
    };
  }

  const summaries: RoleSummary[] = roleNames.map((r) => {
    const sheet = generateRoleCheatSheet(r, {
      compact: true,
      ...(rolesDir !== undefined ? { rolesDir } : {}),
    });
    return {
      role: sheet.role,
      tier: sheet.tier,
      commandCount: sheet.grantedCommands.length,
      spawnsCount: sheet.spawns.length,
      spawns: sheet.spawns,
      invariantsCount: sheet.invariants.length,
      domain: sheet.domain,
    };
  });

  const table = renderAsciiRoleTable(summaries);
  const markdown = [
    "### 🛡️ Available Role Contracts",
    `Total registered roles: **${roleNames.length}**`,
    "",
    table,
    "",
    "Use `--role <name>` to view detailed cheat sheet, or `--all` to print all roles.",
  ].join("\n");

  return {
    markdown,
    total_roles: summaries.length,
    table,
    roles: summaries,
  };
}

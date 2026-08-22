import {
  generateRoleCheatSheet,
  listAvailableRoles,
  renderAsciiRoleTable,
  type RoleCheatSheet,
  type RoleCheatSheetOptions,
  type RoleSummary,
} from "../../roles/cheat-sheets.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

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
    const sheets: RoleCheatSheet[] = roleNames.map((r) =>
      generateRoleCheatSheet(r, options),
    );
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

import type { RoleCheatSheet, RoleSummary } from "./types.ts";

export function renderAsciiRoleTable(roles: readonly (RoleSummary | RoleCheatSheet)[]): string {
  if (roles.length === 0) {
    return "(no roles found)";
  }

  const rows = roles.map((r) => {
    const roleName = r.role;
    const tierStr = String(r.tier);
    const cmdCount =
      "commandCount" in r ? String(r.commandCount) : String(r.grantedCommands.length);
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
      r.spawns.length > colSpawnsWidth ? `${r.spawns.slice(0, colSpawnsWidth - 3)}...` : r.spawns;
    return `│ ${r.role.padEnd(colRoleWidth)} │ ${r.tier.padEnd(colTierWidth)} │ ${r.commands.padEnd(colCmdWidth)} │ ${spawnsTruncated.padEnd(colSpawnsWidth)} │ ${r.invariants.padEnd(colInvWidth)} │`;
  });

  return [topBorder, header, midBorder, ...dataLines, botBorder].join("\n");
}

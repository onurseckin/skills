import { listAvailableRoles } from "../../roles/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export function roleListCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const rolesDir = textFlag(flags, "roles-dir", false) ?? textFlag(flags, "dir", false);
  const roles = listAvailableRoles(rolesDir);

  return {
    roles,
    total: roles.length,
  };
}

export async function executeRoleList(_argv: readonly string[]): Promise<number> {
  const roles = listAvailableRoles();
  process.stdout.write(JSON.stringify({ roles, total: roles.length }) + "\n");
  return 0;
}

import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  roleCheatSheetCommand,
  roleListCommand,
  roleProfileCommand,
} from "../../../olt/scripts/src/cli/commands/role-ops.ts";

describe("Role CLI commands", () => {
  test("role:list returns available roles", () => {
    const res = roleListCommand({});
    expect(Array.isArray(res.roles)).toBe(true);
    expect(res.total as number).toBeGreaterThan(0);
    expect(res.roles as string[]).toContain("implementer");
  });

  test("role:profile resolves agent profiles and archetypes", () => {
    const roleRes = roleProfileCommand({
      role: "implementer",
    });
    expect(roleRes.role).toBe("implementer");
    expect(roleRes.profile).toBe("default");

    const profRes = roleProfileCommand({
      profile: "deliberate",
    });
    expect(profRes.profile).toBe("deliberate");

    const allRes = roleProfileCommand({});
    expect(allRes.abstractProfiles).toBeDefined();
    expect(allRes.roleProfileMap).toBeDefined();
  });

  test("role:cheat-sheet generates formatted cheat sheets", async () => {
    const singleRes = await roleCheatSheetCommand({
      role: "implementer",
    });
    expect(typeof singleRes.markdown).toBe("string");
    expect(singleRes.role).toBe("implementer");

    const allRes = await roleCheatSheetCommand({
      all: true,
    });
    expect(typeof allRes.markdown).toBe("string");
    expect(allRes.total_roles as number).toBeGreaterThan(0);

    const compactRes = await roleCheatSheetCommand({
      compact: true,
    });
    expect(typeof compactRes.markdown).toBe("string");
  });

  test("CLI execute dispatches role commands and aliases through registry", async () => {
    const listRes = await execute(["role:list"]);
    expect(Array.isArray(listRes.roles)).toBe(true);

    const profileRes = await execute(["role:profile", "--role", "planner"]);
    expect(profileRes.role).toBe("planner");
    expect(profileRes.profile).toBe("deliberate");

    const sheetRes = await execute(["role:cheat-sheet", "--role", "implementer"]);
    expect(sheetRes.role).toBe("implementer");

    const cheatRes = await execute(["role:cheat", "--role", "implementer"]);
    expect(cheatRes.role).toBe("implementer");

    const contractRes = await execute(["role:contract", "--role", "implementer"]);
    expect(contractRes.role).toBe("implementer");
  });
});

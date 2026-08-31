import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { roleCheatSheetCommand } from "../../../olt/scripts/src/cli/commands/role-cheat-sheet.ts";

describe("role:cheat-sheet CLI command", () => {
  test("generates cheat sheet for a specific role", async () => {
    const result = await roleCheatSheetCommand({
      role: "implementer",
      compact: true,
    });

    expect(result.role).toBe("implementer");
    expect(result.tier).toBeDefined();
    expect(result.cheat_sheet).toBeDefined();
    expect(typeof result.markdown).toBe("string");
  });

  test("generates full cheat sheets with --all flag", async () => {
    const result = await roleCheatSheetCommand({
      all: true,
    });

    expect(result.total_roles).toBeGreaterThan(0);
    expect(result.table).toBeDefined();
    expect(result.roles).toBeDefined();
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("System Role Catalog");
  });

  test("generates compact summary table by default", async () => {
    const result = await roleCheatSheetCommand({});

    expect(result.total_roles).toBeGreaterThan(0);
    expect(result.table).toBeDefined();
    expect(result.roles).toBeDefined();
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("Available Role Contracts");
  });

  test("dispatches via execute and rejects retired aliases", async () => {
    const sheet = await execute(["role:cheat-sheet", "--role", "planner"]);
    expect(sheet.role).toBe("planner");

    await expect(execute(["role:contract", "--role", "validator"])).rejects.toThrow(
      "unknown command: role:contract",
    );
    await expect(execute(["role:cheat", "--all"])).rejects.toThrow("unknown command: role:cheat");
  });
});

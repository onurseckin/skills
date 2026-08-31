import { describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  executeRoleList,
  executeRoleProfile,
  roleCheatSheetCommand,
  roleListCommand,
  roleProfileCommand,
} from "../../../olt/scripts/src/cli/commands/role-ops.ts";

describe("Role CLI Commands & JSON Contract Verification", () => {
  test("role:list returns strongly typed roles array and total count", () => {
    const res = roleListCommand({});
    expect(Array.isArray(res.roles)).toBeTrue();
    expect(typeof res.total).toBe("number");
    expect(res.total as number).toBeGreaterThan(0);
    expect(res.roles as string[]).toContain("implementer");
    expect(res.roles as string[]).toContain("orchestrator");
    expect(res.roles as string[]).toContain("validator");
  });

  test("role:list supports custom roles directory parameter", () => {
    const res = roleListCommand({ dir: "olt/agents" });
    expect(Array.isArray(res.roles)).toBeTrue();
    expect(res.total as number).toBeGreaterThanOrEqual(0);
  });

  test("executeRoleList executes command line entrypoint and returns exit code 0", async () => {
    const exitCode = await executeRoleList([]);
    expect(exitCode).toBe(0);
  });

  test("role:profile resolves role to abstract profile and host support contracts", () => {
    const implRes = roleProfileCommand({ role: "implementer" });
    expect(implRes.role).toBe("implementer");
    expect(implRes.profile).toBe("default");
    expect(typeof implRes.supportedOnHost).toBe("boolean");
    expect(implRes.resolution).toBeDefined();

    const plannerRes = roleProfileCommand({ role: "planner" });
    expect(plannerRes.role).toBe("planner");
    expect(plannerRes.profile).toBe("deliberate");
  });

  test("role:profile resolves abstract profile to model tiers and thinking levels", () => {
    const profRes = roleProfileCommand({ profile: "deliberate" });
    expect(profRes.profile).toBe("deliberate");
    expect(typeof profRes.bound).toBe("boolean");
    expect(typeof profRes.model).toBe("string");
    expect(typeof profRes.model_tier).toBe("string");
    expect(typeof profRes.thinking_level).toBe("string");
    expect(profRes.resolved).toBeDefined();

    const cheapRes = roleProfileCommand({ profile: "cheap_bulk" });
    expect(cheapRes.profile).toBe("cheap_bulk");
    expect(typeof cheapRes.bound).toBe("boolean");
    expect(typeof cheapRes.model_tier).toBe("string");
  });

  test("role:profile returns complete profile maps when no args specified", () => {
    const mapRes = roleProfileCommand({});
    expect(mapRes.abstractProfiles).toBeDefined();
    expect(mapRes.roleProfileMap).toBeDefined();
    expect(typeof mapRes.abstractProfiles).toBe("object");
    expect(typeof mapRes.roleProfileMap).toBe("object");
  });

  test("executeRoleProfile executes CLI entrypoint and returns exit code 0", async () => {
    const exitCode = await executeRoleProfile([]);
    expect(exitCode).toBe(0);
  });

  test("role:cheat-sheet produces markdown documentation contracts", async () => {
    const singleRes = await roleCheatSheetCommand({ role: "implementer" });
    expect(typeof singleRes.markdown).toBe("string");
    expect(singleRes.role).toBe("implementer");
    expect((singleRes.markdown as string).length).toBeGreaterThan(50);

    const allRes = await roleCheatSheetCommand({ all: true });
    expect(typeof allRes.markdown).toBe("string");
    expect(allRes.total_roles as number).toBeGreaterThan(0);

    const compactRes = await roleCheatSheetCommand({ compact: true });
    expect(typeof compactRes.markdown).toBe("string");
  });

  test("CLI execute registry dispatches role:* commands", async () => {
    const listOut = await execute(["role:list"]);
    expect(Array.isArray(listOut.roles)).toBeTrue();
    expect(listOut.total).toBeGreaterThan(0);

    const profileOut = await execute(["role:profile", "--role", "validator"]);
    expect(profileOut.role).toBe("validator");
    expect(profileOut.profile).toBe("adversarial");

    const sheetOut = await execute(["role:cheat-sheet", "--role", "implementer"]);
    expect(sheetOut.role).toBe("implementer");
    expect(typeof sheetOut.markdown).toBe("string");
  });
});

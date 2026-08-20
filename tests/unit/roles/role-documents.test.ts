import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_ROLES,
  isAgentRole,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import {
  loadRoleContract,
  resolveRoleContractPath,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";

const rolesRoot = dirname(resolveRoleContractPath("planner"));

describe("canonical role documents", () => {
  test("roles/ holds exactly one document per canonical role", () => {
    const documented = readdirSync(rolesRoot)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => entry.slice(0, -3))
      .sort();
    expect(documented).toEqual([...AGENT_ROLES].sort());
  });

  test("every role document declares a nonempty capability contract", () => {
    for (const role of AGENT_ROLES) {
      const contract = loadRoleContract(role);
      expect(contract.role).toBe(role);
      expect(contract.tier).toBeGreaterThanOrEqual(1);
      expect(contract.tier).toBeLessThanOrEqual(3);
      expect(contract.may.length).toBeGreaterThan(0);
      expect(contract.must_not.length).toBeGreaterThan(0);
      expect(contract.commands.length).toBeGreaterThan(0);
      expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/u);
      for (const entry of [...contract.may, ...contract.must_not, ...contract.commands])
        expect(entry.trim()).toBe(entry);
    }
  });

  test("commands are named without flag syntax so they cannot drift from the manifest", () => {
    for (const role of AGENT_ROLES)
      for (const command of loadRoleContract(role).commands)
        expect(command).toMatch(/^[a-z][a-z-]*(?::[a-z][a-z-]*)?$/u);
  });

  test("spawns name canonical roles and match the documented branch topology", () => {
    const spawns = new Map(
      AGENT_ROLES.map((role) => [role, loadRoleContract(role).spawns] as const),
    );
    for (const [role, spawned] of spawns) {
      for (const child of spawned) {
        expect(isAgentRole(child)).toBe(true);
        expect(child).not.toBe(role);
      }
    }
    expect(spawns.get("implementer")).toEqual(["sub-implementer", "sub-investigator"]);
    expect(spawns.get("validator")).toEqual(["sub-validator"]);
    for (const role of ["sub-implementer", "sub-validator", "sub-investigator"] as const)
      expect(spawns.get(role)).toEqual([]);
  });

  test("sub-investigator is read-only and the drivers never edit the repository", () => {
    const investigator = loadRoleContract("sub-investigator");
    expect(investigator.must_not.join("\n")).toContain(
      "Create, edit, stage, revert, format, or delete any repository file",
    );
    expect(loadRoleContract("coordinator").must_not.join("\n")).toContain(
      "Write, edit, stage, revert, format, or delete any repository file",
    );
  });
});

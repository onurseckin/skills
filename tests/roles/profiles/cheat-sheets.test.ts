import { describe, expect, test } from "bun:test";
import { roleCheatSheetCommand } from "../../../olt/scripts/src/cli/commands/role-cheat-sheet.ts";
import {
  formatUniversalCheatSheet,
  generateRoleCheatSheet,
  listAvailableRoles,
  parseRoleContract,
  renderAsciiRoleTable,
  type RoleSummary,
  type UniversalRoleSpec,
} from "../../../olt/scripts/src/roles/index.ts";

const SAMPLE_CONTRACT = `---
role: implementer
tier: 3
may:
  - Claim a ready task
  - Edit files inside leased write scope
must_not:
  - Touch path outside lease
  - Run full test suite
commands:
  - task:claim
  - task:submit
spawns:
  - sub-implementer
---

# Implementer

The implementer writes code strictly within the leased write scope.

- **Focused Execution**: Execute only focused tests.
`;

describe("Dynamic Role Cheat-Sheets Engine", () => {
  describe("parseRoleContract", () => {
    test("parses role contract from string", () => {
      const contract = parseRoleContract(SAMPLE_CONTRACT, "sample.md");
      expect(contract.role).toBe("implementer");
      expect(contract.tier).toBe(3);
      expect(contract.commands).toEqual(["task:claim", "task:submit"]);
      expect(contract.may).toHaveLength(2);
      expect(contract.must_not).toHaveLength(2);
      expect(contract.spawns).toEqual(["sub-implementer"]);
    });

    test("parses role contract from Uint8Array", () => {
      const bytes = new TextEncoder().encode(SAMPLE_CONTRACT);
      const contract = parseRoleContract(bytes, "sample.md");
      expect(contract.role).toBe("implementer");
      expect(contract.tier).toBe(3);
    });
  });

  describe("listAvailableRoles", () => {
    test("discovers all checked-in role contracts", () => {
      const roles = listAvailableRoles();
      expect(roles.length).toBeGreaterThan(5);
      expect(roles).toContain("coordinator");
      expect(roles).toContain("implementer");
      expect(roles).toContain("mind");
      expect(roles).toContain("orchestrator");
      expect(roles).toContain("validator");
      expect(roles).toContain("validator-code-quality");
    });

    test("fails gracefully on non-existent roles directory", () => {
      expect(() => listAvailableRoles("/non/existent/roles/dir")).toThrow(
        /roles directory does not exist/,
      );
    });
  });

  describe("formatUniversalCheatSheet", () => {
    test("formats universal cheat sheet for generic dynamic role spec", () => {
      const spec: UniversalRoleSpec = {
        name: "custom-worker",
        tier: 3,
        title: "Custom Worker",
        summary: "Custom dynamic worker role",
        domain: "system-design",
        archetype: "tier_3_specialist",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["task:claim", "task:submit"],
        permittedActivities: ["Claim task", "Submit task"],
        prohibitedActions: ["Touch outside scope"],
        invariants: ["Must adhere to isolation"],
        spawns: [],
        cognitivePillars: ["Zero leakage", "High fidelity"],
      };

      const sheet = formatUniversalCheatSheet(spec);
      expect(sheet.role).toBe("custom-worker");
      expect(sheet.tier).toBe(3);
      expect(sheet.markdown).toContain("### 🛡️ Role Contract: `custom-worker` (Tier 3)");
      expect(sheet.markdown).toContain("Specialization Domain");
      expect(sheet.markdown).toContain("Archetype");
      expect(sheet.markdown).toContain("Write Scope Policy");
      expect(sheet.markdown).toContain("#### 🧠 Cognitive Pillars");
    });
  });

  describe("generateRoleCheatSheet", () => {
    test("generates full cheat-sheet for implementer", () => {
      const sheet = generateRoleCheatSheet("implementer");
      expect(sheet.role).toBe("implementer");
      expect(sheet.tier).toBe(3);
      expect(sheet.title).toBe("Implementer");
      expect(sheet.grantedCommands).toContain("task:claim");
      expect(sheet.grantedCommands).toContain("task:submit");
      expect(sheet.commandDetails.length).toBe(sheet.grantedCommands.length);
      expect(sheet.forbiddenActions.length).toBeGreaterThan(0);
      expect(sheet.invariants.length).toBeGreaterThan(0);
      expect(sheet.spawns).toContain("sub-implementer");

      expect(sheet.markdown).toContain("### 🛡️ Role Contract: `implementer`");
      expect(sheet.markdown).toContain("#### ⚡ Granted CLI Verbs & Syntax");
      expect(sheet.markdown).toContain("#### 🚫 Invariants & Absolute Prohibitions");
    });

    test("generates full cheat-sheet for coordinator", () => {
      const sheet = generateRoleCheatSheet("coordinator");
      expect(sheet.role).toBe("coordinator");
      expect(sheet.tier).toBe(2);
      expect(sheet.title).toBe("Coordinator");
      expect(sheet.grantedCommands).toContain("plan:compile");
      expect(sheet.grantedCommands).toContain("queue:wave");
      expect(sheet.spawns).toContain("implementer");
      expect(sheet.spawns).toContain("validator");
    });

    test("generates full cheat-sheet for mind with cognitive pillars", () => {
      const sheet = generateRoleCheatSheet("mind");
      expect(sheet.role).toBe("mind");
      expect(sheet.tier).toBe(0);
      expect(sheet.grantedCommands).toContain("mind:pulse-open");
      expect(sheet.grantedCommands).toContain("mind:candidate");
      expect(sheet.cognitivePillars).toBeDefined();
      expect(sheet.cognitivePillars?.length).toBeGreaterThan(0);
      expect(sheet.markdown).toContain("#### 🧠 Cognitive Pillars");
    });

    test("generates compact cheat-sheet", () => {
      const sheet = generateRoleCheatSheet("implementer", { compact: true });
      expect(sheet.role).toBe("implementer");
      expect(sheet.markdown).toContain("### ⚡ Compact Cheat-Sheet: `implementer`");
      expect(sheet.markdown).toContain("Key Invariants");
      expect(sheet.markdown).toContain("task:claim");
    });

    test("handles domain-specific validator role contracts", () => {
      const sheet = generateRoleCheatSheet("validator-code-quality");
      expect(sheet.role).toBe("validator");
      expect(sheet.domain).toBe("code-quality");
      expect(sheet.grantedCommands).not.toContain("run:exec");
      expect(sheet.authorityRules.some((r) => r.toLowerCase().includes("anti-boundary-leak"))).toBe(
        true,
      );
    });

    test("reflects anti-boundary-leak rule in validator and completeness-critic cheat sheets", () => {
      const validatorSheet = generateRoleCheatSheet("validator");
      expect(
        validatorSheet.authorityRules.some((r) => r.toLowerCase().includes("anti-boundary-leak")),
      ).toBe(true);
      expect(
        validatorSheet.invariants.some((inv) => inv.toLowerCase().includes("anti-boundary-leak")),
      ).toBe(true);

      const criticSheet = generateRoleCheatSheet("completeness-critic");
      expect(
        criticSheet.authorityRules.some((r) => r.toLowerCase().includes("anti-boundary-leak")),
      ).toBe(true);
      expect(
        criticSheet.invariants.some((inv) => inv.toLowerCase().includes("anti-boundary-leak")),
      ).toBe(true);
    });

    test("throws when role contract does not exist", () => {
      expect(() => generateRoleCheatSheet("non-existent-role-xyz")).toThrow(
        /role contract not found/,
      );
    });
  });

  describe("renderAsciiRoleTable", () => {
    test("renders clean unicode box table for role summaries", () => {
      const summaries: RoleSummary[] = [
        {
          role: "mind",
          tier: 0,
          commandCount: 27,
          spawnsCount: 1,
          spawns: ["orchestrator"],
          invariantsCount: 10,
        },
        {
          role: "coordinator",
          tier: 2,
          commandCount: 40,
          spawnsCount: 4,
          spawns: ["planner", "implementer", "validator", "repairer"],
          invariantsCount: 17,
        },
        {
          role: "implementer",
          tier: 3,
          commandCount: 16,
          spawnsCount: 2,
          spawns: ["sub-implementer", "sub-investigator"],
          invariantsCount: 8,
        },
      ];

      const table = renderAsciiRoleTable(summaries);
      expect(table).toContain("┌");
      expect(table).toContain("└");
      expect(table).toContain("│ Role");
      expect(table).toContain("│ Tier");
      expect(table).toContain("│ Commands");
      expect(table).toContain("│ Spawns");
      expect(table).toContain("mind");
      expect(table).toContain("coordinator");
      expect(table).toContain("implementer");
    });

    test("handles empty role list", () => {
      const table = renderAsciiRoleTable([]);
      expect(table).toBe("(no roles found)");
    });
  });

  describe("roleCheatSheetCommand CLI handler", () => {
    test("executes with --role flag for single role", async () => {
      const res = await roleCheatSheetCommand({
        role: "implementer",
      });

      expect(res.role).toBe("implementer");
      expect(res.tier).toBe(3);
      expect(typeof res.markdown).toBe("string");
      expect(res.markdown).toContain("implementer");
      expect(res.cheat_sheet).toBeDefined();
    });

    test("executes with --role and --compact flag", async () => {
      const res = await roleCheatSheetCommand({
        role: "coordinator",
        compact: true,
      });

      expect(res.role).toBe("coordinator");
      expect(res.tier).toBe(2);
      expect(res.markdown).toContain("Compact Cheat-Sheet");
    });

    test("executes with --all flag", async () => {
      const res = await roleCheatSheetCommand({
        all: true,
      });

      expect(typeof res.total_roles).toBe("number");
      expect(res.total_roles as number).toBeGreaterThan(5);
      expect(Array.isArray(res.roles)).toBe(true);
      expect(typeof res.markdown).toBe("string");
      expect(res.markdown).toContain("System Role Catalog");
      expect(typeof res.table).toBe("string");
    });

    test("executes default list when neither --role nor --all is given", async () => {
      const res = await roleCheatSheetCommand({});

      expect(typeof res.total_roles).toBe("number");
      expect(res.total_roles as number).toBeGreaterThan(5);
      expect(Array.isArray(res.roles)).toBe(true);
      expect(typeof res.markdown).toBe("string");
      expect(res.markdown).toContain("Available Role Contracts");
      expect(typeof res.table).toBe("string");
    });
  });
});

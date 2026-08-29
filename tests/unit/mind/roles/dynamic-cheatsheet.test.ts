import { describe, expect, test } from "bun:test";
import {
  generateDynamicRoleCheatSheet,
  synthesizeDynamicRole,
} from "../../../../olt/scripts/src/mind/roles/index.ts";

describe("Mind dynamic role cheat sheet generation", () => {
  test("generates full cheat sheet from dynamic role contract", () => {
    const contract = synthesizeDynamicRole({
      name: "dynamic-auditor",
      archetype: "tier_3_validator",
      domain: "security",
      title: "Dynamic Security Auditor",
      summary: "Audits security invariants dynamically.",
    });

    const sheet = generateDynamicRoleCheatSheet(contract);
    expect(sheet.role).toBe("dynamic-auditor");
    expect(sheet.tier).toBe(3);
    expect(sheet.markdown).toContain("### 🛡️ Role Contract: `dynamic-auditor` (Tier 3)");
    expect(sheet.markdown).toContain("Specialization Domain");
    expect(sheet.markdown).toContain("security");
    expect(sheet.markdown).toContain("#### ⚡ Granted CLI Verbs & Syntax");
  });

  test("generates compact cheat sheet from dynamic role spec", () => {
    const contract = synthesizeDynamicRole({
      name: "dynamic-builder",
      archetype: "tier_3_implementer",
      domain: "code-quality",
    });

    const sheet = generateDynamicRoleCheatSheet(contract.spec, { compact: true });
    expect(sheet.role).toBe("dynamic-builder");
    expect(sheet.markdown).toContain("### ⚡ Compact Cheat-Sheet: `dynamic-builder` (Tier 3)");
    expect(sheet.markdown).toContain("Granted Commands");
    expect(sheet.markdown).toContain("Key Invariants");
  });
});

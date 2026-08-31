import { describe, expect, test } from "bun:test";
import {
  generateDynamicRoleCheatSheet,
  synthesizeDynamicRole,
} from "../../../../olt/scripts/src/mind/roles/index.ts";
import { formatUniversalCheatSheet } from "../../../../olt/scripts/src/roles/index.ts";

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
    expect(sheet.commandDetails.length).toBeGreaterThan(0);
    expect(sheet.invariants.length).toBeGreaterThan(0);
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

  test("delegates dynamic role spec formatting identically to universal cheat sheet formatter", () => {
    const contract = synthesizeDynamicRole({
      name: "dynamic-researcher",
      archetype: "tier_3_specialist",
      domain: "system-design",
    });

    const directSheet = formatUniversalCheatSheet(contract.spec);
    const adapterSheet = generateDynamicRoleCheatSheet(contract);
    expect(adapterSheet.markdown).toBe(directSheet.markdown);
    expect(adapterSheet.role).toBe(directSheet.role);
    expect(adapterSheet.tier).toBe(directSheet.tier);
    expect(adapterSheet.grantedCommands).toEqual(directSheet.grantedCommands);
  });

  test("formats dynamic role with cognitive pillars and custom prohibitions", () => {
    const contract = synthesizeDynamicRole({
      name: "dynamic-sentinel",
      archetype: "tier_2_critic",
      domain: "security",
      cognitivePillars: ["Zero-trust verification", "Exhaustive threat modeling"],
    });

    const sheet = generateDynamicRoleCheatSheet(contract);
    expect(sheet.markdown).toContain("#### 🧠 Cognitive Pillars");
    expect(sheet.markdown).toContain("Zero-trust verification");
    expect(sheet.markdown).toContain("Exhaustive threat modeling");
    expect(sheet.cognitivePillars).toEqual([
      "Zero-trust verification",
      "Exhaustive threat modeling",
    ]);
  });
});

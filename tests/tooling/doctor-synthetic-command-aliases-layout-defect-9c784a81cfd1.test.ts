import { describe, expect, test } from "bun:test";
import {
  buildDefaultSyntheticCommandAliases,
  remediateDoctorSyntheticCommandAliasesLayout,
  validateDoctorSyntheticCommandAliasesLayout,
  type CommandAliasEntry,
} from "../../olt/scripts/src/tooling/doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1.ts";

describe("doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1", () => {
  test("default synthetic command aliases are valid and non-empty", () => {
    const aliases = buildDefaultSyntheticCommandAliases();
    expect(aliases.length).toBeGreaterThan(0);
    for (const item of aliases) {
      expect(item.alias.length).toBeGreaterThan(0);
      expect(item.canonicalCommand.length).toBeGreaterThan(0);
      expect(item.domain.length).toBeGreaterThan(0);
      expect(item.isSynthetic).toBe(true);
    }
  });

  test("validation succeeds on default aliases", () => {
    const aliases = buildDefaultSyntheticCommandAliases();
    const result = validateDoctorSyntheticCommandAliasesLayout(aliases);
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  test("validation detects duplicate aliases", () => {
    const aliases: CommandAliasEntry[] = [
      {
        alias: "test:dup",
        canonicalCommand: "run:exec",
        domain: "run",
        description: "First",
        isSynthetic: true,
      },
      {
        alias: "test:dup",
        canonicalCommand: "run:status",
        domain: "run",
        description: "Second",
        isSynthetic: true,
      },
    ];
    const result = validateDoctorSyntheticCommandAliasesLayout(aliases);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("Duplicate alias"))).toBe(true);
  });

  test("validation detects empty aliases and invalid canonical commands", () => {
    const aliases: CommandAliasEntry[] = [
      {
        alias: "",
        canonicalCommand: "invalid",
        domain: "run",
        description: "Empty",
        isSynthetic: true,
      },
    ];
    const result = validateDoctorSyntheticCommandAliasesLayout(aliases);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes("Empty alias"))).toBe(true);
  });

  test("remediation function returns positive defect remediation result", () => {
    const res = remediateDoctorSyntheticCommandAliasesLayout();
    expect(res.defectId).toBe("doctor-synthetic-command-aliases-layout-defect-9c784a81cfd1");
    expect(res.defectRemediated).toBe(true);
    expect(res.layout.layoutValid).toBe(true);
    expect(res.layout.syntheticCount).toBe(res.layout.totalCount);
    expect(res.issues.length).toBe(0);
  });
});

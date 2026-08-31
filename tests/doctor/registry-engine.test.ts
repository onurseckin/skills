import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  checkCliRegistryTaxonomy,
  type CliRegistryTaxonomyCheckOptions,
} from "../../olt/scripts/src/reporting/doctor/registry-engine.ts";
import type { CommandSpec } from "../../olt/scripts/src/cli/registry/types.ts";

describe("Doctor CLI Registry Taxonomy & Zero-Alias Engine", () => {
  test("passes live COMMAND_REGISTRY with 100% compliance and zero findings", () => {
    const result = checkCliRegistryTaxonomy();
    expect(result.engine).toBe("checkCliRegistryTaxonomy");
    expect(result.passed).toBeTrue();
    expect(result.findings).toEqual([]);
  });

  test("detects alias proliferation and records CLI_ALIAS_PROLIFERATION finding", () => {
    const dirtySpec: CommandSpec = {
      name: "test:aliased",
      aliases: ["legacy-alias"],
      domain: "plan",
      summary: "Test command",
      description: "Test description",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: () => ({ ok: true }),
    };

    const result = checkCliRegistryTaxonomy({ registry: [dirtySpec] });
    expect(result.passed).toBeFalse();
    expect(result.findings.some((f) => f.code === "CLI_ALIAS_PROLIFERATION")).toBeTrue();
    const finding = result.findings.find((f) => f.code === "CLI_ALIAS_PROLIFERATION");
    expect(finding?.severity).toBe("ERROR");
    expect(finding?.details?.["command"]).toBe("test:aliased");
  });

  test("detects taxonomy violations for non-canonical command names", () => {
    const invalidSpec: CommandSpec = {
      name: "INVALID COMMAND NAME!",
      aliases: [],
      domain: "task",
      summary: "Invalid syntax",
      description: "Invalid syntax",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: () => ({ ok: true }),
    };

    const result = checkCliRegistryTaxonomy({ registry: [invalidSpec] });
    expect(result.passed).toBeFalse();
    expect(result.findings.some((f) => f.code === "CLI_TAXONOMY_VIOLATION")).toBeTrue();
  });

  test("detects unregistered domains", () => {
    const badDomainSpec: CommandSpec = {
      name: "custom:sub",
      aliases: [],
      domain: "nonexistent_domain" as unknown as CommandSpec["domain"],
      summary: "Bad domain",
      description: "Bad domain",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: () => ({ ok: true }),
    };

    const result = checkCliRegistryTaxonomy({ registry: [badDomainSpec] });
    expect(result.passed).toBeFalse();
    expect(result.findings.some((f) => f.code === "CLI_UNKNOWN_DOMAIN")).toBeTrue();
  });

  test("detects duplicate command registrations", () => {
    const specA: CommandSpec = {
      name: "duplicate:cmd",
      aliases: [],
      domain: "run",
      summary: "Summary A",
      description: "Desc A",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: () => ({ ok: true }),
    };
    const specB: CommandSpec = {
      name: "duplicate:cmd",
      aliases: [],
      domain: "run",
      summary: "Summary B",
      description: "Desc B",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: () => ({ ok: true }),
    };

    const result = checkCliRegistryTaxonomy({ registry: [specA, specB] });
    expect(result.passed).toBeFalse();
    expect(result.findings.some((f) => f.code === "CLI_DUPLICATE_COMMAND")).toBeTrue();
  });

  test("detects missing metadata and non-callable handlers", () => {
    const invalidMetadataSpec: CommandSpec = {
      name: "meta:broken",
      aliases: [],
      domain: "mind",
      summary: "",
      description: "   ",
      flags: [],
      readsStdin: false,
      takesRemainder: false,
      exitCodes: [{ code: 0, meaning: "OK" }],
      examples: [],
      handler: null as unknown as CommandSpec["handler"],
    };

    const result = checkCliRegistryTaxonomy({ registry: [invalidMetadataSpec] });
    expect(result.passed).toBeFalse();
    expect(result.findings.some((f) => f.code === "CLI_MISSING_SUMMARY")).toBeTrue();
    expect(result.findings.some((f) => f.code === "CLI_MISSING_DESCRIPTION")).toBeTrue();
    expect(result.findings.some((f) => f.code === "CLI_INVALID_HANDLER")).toBeTrue();
  });

  test("verifies test file contains zero any and zero suppressions", () => {
    const testFile = readFileSync(__filename, "utf-8");
    expect(testFile).not.toContain("@ts-" + "ignore");
    expect(testFile).not.toContain("@ts-" + "expect-error");
    expect(testFile).not.toContain("eslint-" + "disable");
    expect(testFile).not.toContain(": " + "any");
  });
});

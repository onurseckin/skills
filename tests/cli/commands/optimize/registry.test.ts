import { describe, expect, test } from "bun:test";
import { optimizeAnalyzeCommand } from "../../../../olt/scripts/src/cli/commands/optimize/analyze.ts";
import { optimizeCheckAstCommand } from "../../../../olt/scripts/src/cli/commands/optimize/check-ast.ts";
import { optimizeCheckDriftCommand } from "../../../../olt/scripts/src/cli/commands/optimize/drift.ts";
import { optimizeQuarantineCommand } from "../../../../olt/scripts/src/cli/commands/optimize/quarantine.ts";
import { optimizeScanCommand } from "../../../../olt/scripts/src/cli/commands/optimize/scan.ts";
import { optimizeCheckTestsCommand } from "../../../../olt/scripts/src/cli/commands/optimize/check-tests.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandTier,
  findCommand,
  flagShapes,
  isInternalCommand,
  isPrimaryCommand,
  OPTIMIZE_COMMANDS,
  type CommandSpec,
} from "../../../../olt/scripts/src/cli/registry/index.ts";

describe("Optimize CLI Registry & Router", () => {
  const EXPECTED_COMMANDS: readonly {
    readonly name: string;
    readonly aliases: readonly string[];
    readonly expectedFlags: readonly string[];
    readonly requiredFlags: readonly string[];
    readonly handler: unknown;
  }[] = [
    {
      name: "optimize:scan",
      aliases: ["opt:scan"],
      expectedFlags: ["dir", "root", "strict", "json", "pillar", "limit"],
      requiredFlags: [],
      handler: optimizeScanCommand,
    },
    {
      name: "optimize:analyze",
      aliases: ["opt:analyze"],
      expectedFlags: ["target", "out", "dry-run", "json"],
      requiredFlags: ["target"],
      handler: optimizeAnalyzeCommand,
    },
    {
      name: "optimize:check-ast",
      aliases: ["opt:check-ast"],
      expectedFlags: ["pre", "post", "target", "strict", "json"],
      requiredFlags: [],
      handler: optimizeCheckAstCommand,
    },
    {
      name: "optimize:check-tests",
      aliases: ["opt:check-tests"],
      expectedFlags: ["target", "base", "diff", "json"],
      requiredFlags: [],
      handler: optimizeCheckTestsCommand,
    },
    {
      name: "optimize:quarantine",
      aliases: ["opt:quarantine"],
      expectedFlags: ["plan", "reason", "defect", "dry-run", "json", "failure-logs", "clean-all"],
      requiredFlags: ["plan"],
      handler: optimizeQuarantineCommand,
    },
    {
      name: "optimize:check-drift",
      aliases: ["opt:check-drift", "opt:drift"],
      expectedFlags: ["base", "target", "paths", "json", "strict"],
      requiredFlags: [],
      handler: optimizeCheckDriftCommand,
    },
  ];

  test("OPTIMIZE_COMMANDS contains exactly 6 commands with domain 'optimize'", () => {
    expect(OPTIMIZE_COMMANDS.length).toBe(6);
    expect(COMMAND_DOMAINS).toContain("optimize");

    for (const spec of OPTIMIZE_COMMANDS) {
      expect(spec.domain).toBe("optimize");
      expect(spec.tier).toBe("internal");
      expect(commandTier(spec)).toBe("internal");
      expect(isInternalCommand(spec)).toBe(true);
      expect(isPrimaryCommand(spec)).toBe(false);
      expect(spec.readsStdin).toBe(false);
      expect(spec.takesRemainder).toBe(false);
      expect(spec.exitCodes.length).toBeGreaterThan(0);
      expect(spec.exitCodes.some((ec) => ec.code === 0)).toBe(true);
      expect(typeof spec.summary).toBe("string");
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(typeof spec.description).toBe("string");
      expect(spec.description.length).toBeGreaterThan(0);
      expect(Array.isArray(spec.examples)).toBe(true);
      expect(spec.examples.length).toBeGreaterThan(0);
    }
  });

  test("all 6 optimize commands are discoverable in COMMAND_REGISTRY", () => {
    const registryNames = new Set(COMMAND_REGISTRY.map((s) => s.name));
    for (const item of EXPECTED_COMMANDS) {
      expect(registryNames.has(item.name)).toBe(true);
    }
  });

  test("findCommand resolves canonical names and aliases to the same command spec", () => {
    for (const item of EXPECTED_COMMANDS) {
      const canonical = findCommand(item.name);
      expect(canonical).toBeDefined();
      expect(canonical?.name).toBe(item.name);
      expect(canonical?.handler).toBe(item.handler);
      expect(canonical?.domain).toBe("optimize");

      for (const alias of item.aliases) {
        const byAlias = findCommand(alias);
        expect(byAlias).toBeDefined();
        expect(byAlias).toBe(canonical);
      }
    }
  });

  test("counterfactual tests: invalid or nonexistent verbs return undefined", () => {
    const invalidInvocations = [
      "optimize:invalid-verb",
      "opt:invalid-verb",
      "optimize:scan:extra",
      "opt:unknown",
      "optimize:",
      "opt:",
      "optimize",
      "opt",
      "",
      "   ",
      "optimize:quarantine-now",
      "opt:drift-check",
    ];

    for (const invocation of invalidInvocations) {
      expect(findCommand(invocation)).toBeUndefined();
    }
  });

  test("each command spec correctly binds expected flags and required constraints", () => {
    for (const item of EXPECTED_COMMANDS) {
      const spec = findCommand(item.name) as CommandSpec;
      expect(spec).toBeDefined();

      const flagMap = new Map(spec.flags.map((f) => [f.name, f]));
      for (const flagName of item.expectedFlags) {
        expect(flagMap.has(flagName)).toBe(true);
      }

      for (const reqFlag of item.requiredFlags) {
        const flagSpec = flagMap.get(reqFlag);
        expect(flagSpec?.required).toBe(true);
      }

      const shapes = flagShapes(spec.flags);
      expect(shapes.size).toBe(spec.flags.length);
    }
  });

  test("handlers are properly bound and invocable via registered CommandSpec", async () => {
    const scanSpec = findCommand("optimize:scan");
    expect(scanSpec).toBeDefined();
    const scanResult = await scanSpec!.handler(
      { dir: "nonexistent-dir-12345" },
      { cwd: process.cwd(), stdout: () => {}, stderr: () => {} },
      [],
    );
    expect(scanResult).toBeDefined();
    expect(scanResult["passed"]).toBe(true);

    const driftSpec = findCommand("opt:drift");
    expect(driftSpec).toBeDefined();
    const driftResult = await driftSpec!.handler(
      { paths: "nonexistent/file.ts" },
      { cwd: process.cwd(), stdout: () => {}, stderr: () => {} },
      [],
    );
    expect(driftResult).toBeDefined();
    expect(driftResult["ok"]).toBe(true);
  });
});

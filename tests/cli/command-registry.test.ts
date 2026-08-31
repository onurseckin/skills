import { describe, expect, test } from "bun:test";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandTier,
  findCommand,
  flagShapes,
  isInternalCommand,
  isPrimaryCommand,
  type CommandDomain,
  type CommandSpec,
} from "../../olt/scripts/src/cli/registry/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("Command Registry & Dispatch Invariant Gate", () => {
  test("100% of registered commands declare valid specs with zero aliases", () => {
    expect(COMMAND_REGISTRY.length).toBeGreaterThan(0);
    const seenNames = new Set<string>();

    for (const spec of COMMAND_REGISTRY) {
      expect(typeof spec.name).toBe("string");
      expect(spec.name.length).toBeGreaterThan(0);
      expect(seenNames.has(spec.name)).toBe(false);
      seenNames.add(spec.name);

      expect(Array.isArray(spec.aliases)).toBe(true);
      expect(spec.aliases.length).toBe(0);

      expect(COMMAND_DOMAINS).toContain(spec.domain);
      expect(typeof spec.summary).toBe("string");
      expect(spec.summary.trim().length).toBeGreaterThan(0);
      expect(typeof spec.description).toBe("string");
      expect(spec.description.trim().length).toBeGreaterThan(0);

      expect(Array.isArray(spec.exitCodes)).toBe(true);
      expect(spec.exitCodes.length).toBeGreaterThan(0);
      expect(spec.exitCodes.some((codeSpec) => codeSpec.code === 0)).toBe(true);

      expect(typeof spec.handler).toBe("function");
    }
  });

  test("every domain in COMMAND_DOMAINS is populated by registered commands", () => {
    const activeDomains = new Set<CommandDomain>(COMMAND_REGISTRY.map((s) => s.domain));
    for (const domain of COMMAND_DOMAINS) {
      expect(activeDomains.has(domain)).toBe(true);
    }
  });

  test("findCommand resolves all commands by canonical name and returns undefined for unknown", () => {
    for (const spec of COMMAND_REGISTRY) {
      const resolved = findCommand(spec.name);
      expect(resolved).toBeDefined();
      expect(resolved?.name).toBe(spec.name);
      expect(resolved?.domain).toBe(spec.domain);
    }

    expect(findCommand("nonexistent:command")).toBeUndefined();
    expect(findCommand("")).toBeUndefined();
  });

  test("tier classification correctly partitions primary vs internal verbs", () => {
    for (const spec of COMMAND_REGISTRY) {
      const tier = commandTier(spec);
      expect(["primary", "internal"]).toContain(tier);
      if (tier === "primary") {
        expect(isPrimaryCommand(spec)).toBe(true);
        expect(isInternalCommand(spec)).toBe(false);
      } else {
        expect(isInternalCommand(spec)).toBe(true);
        expect(isPrimaryCommand(spec)).toBe(false);
      }
    }
  });

  test("flag shapes and coercion metadata conform to declared flag types", () => {
    for (const spec of COMMAND_REGISTRY) {
      const shapes = flagShapes(spec.flags);
      expect(shapes.size).toBe(spec.flags.length);

      const flagNames = new Set<string>();
      for (const flag of spec.flags) {
        expect(flagNames.has(flag.name)).toBe(false);
        flagNames.add(flag.name);

        expect(["string", "int", "bool"]).toContain(flag.type);
        expect(typeof flag.required).toBe("boolean");
        expect(typeof flag.repeatable).toBe("boolean");
        expect(flag.description.trim().length).toBeGreaterThan(0);

        const shape = shapes.get(flag.name);
        expect(shape).toBeDefined();
        expect(shape?.takesValue).toBe(flag.type !== "bool");
        expect(shape?.repeatable).toBe(flag.repeatable);
      }
    }
  });

  test("remainder arguments are strictly permitted only for designated process runners", async () => {
    const remainderCommands = COMMAND_REGISTRY.filter((spec) => spec.takesRemainder).map(
      (s) => s.name,
    );
    expect(remainderCommands.sort()).toEqual(["run:exec", "shell"].sort());

    await expect(execute(["role:list", "--", "unexpected-trailing-argument"])).rejects.toThrow(
      HarnessError,
    );
  });

  test("execute rejects unknown command invocations with exitCode 3", async () => {
    try {
      await execute(["completely-invalid-command-xyz"]);
      expect.unreachable("should have thrown HarnessError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.exitCode).toBe(3);
    }
  });

  test("execute rejects unrecognized options with exitCode 3", async () => {
    try {
      await execute(["role:list", "--completely-unrecognized-flag-xyz", "val"]);
      expect.unreachable("should have thrown HarnessError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_ARGUMENT");
      expect(harnessErr.exitCode).toBe(3);
    }
  });
});

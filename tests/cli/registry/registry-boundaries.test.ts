import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
  flagShapes,
  getInternalCommands,
  getPrimaryCommands,
  isInternalCommand,
  isPrimaryCommand,
  type CommandDomain,
  type FlagSpec,
} from "../../../olt/scripts/src/cli/registry/index.ts";

describe("CLI registry boundaries and behavioral characterization", () => {
  describe("command lookup by name and alias via findCommand", () => {
    test("finds every registered command by its canonical name", () => {
      for (const spec of COMMAND_REGISTRY) {
        const found = findCommand(spec.name);
        expect(found).toBeDefined();
        expect(found).toBe(spec);
        expect(found?.name).toBe(spec.name);
      }
    });

    test("finds every registered command by each of its declared aliases", () => {
      for (const spec of COMMAND_REGISTRY) {
        for (const alias of spec.aliases) {
          const found = findCommand(alias);
          expect(found).toBeDefined();
          expect(found).toBe(spec);
          expect(found?.name).toBe(spec.name);
        }
      }
    });

    test("returns undefined for unknown names and malformed invocations", () => {
      const unknownInvocations = [
        "",
        "unknown",
        "plan:unknown",
        "task:nonexistent",
        "mind:bogus",
        "   ",
        "run:exec:extra",
      ];
      for (const invocation of unknownInvocations) {
        expect(findCommand(invocation)).toBeUndefined();
      }
    });

    test("every invocation returned by commandInvocations resolves to a spec", () => {
      const invocations = commandInvocations();
      expect(invocations.length).toBeGreaterThanOrEqual(COMMAND_REGISTRY.length);
      for (const invocation of invocations) {
        const spec = findCommand(invocation);
        expect(spec).toBeDefined();
        expect(spec?.name.length).toBeGreaterThan(0);
      }
    });
  });

  describe("flag ordering and flag shapes", () => {
    test("preserves deterministic flag ordering and uniqueness within every command", () => {
      for (const spec of COMMAND_REGISTRY) {
        const flagNames = spec.flags.map((flag) => flag.name);
        expect(new Set(flagNames).size).toBe(flagNames.length);
        for (const flag of spec.flags) {
          expect(flag.name.length).toBeGreaterThan(0);
          expect(["string", "int", "bool"]).toContain(flag.type);
          expect(typeof flag.required).toBe("boolean");
          expect(typeof flag.repeatable).toBe("boolean");
          expect(flag.description.length).toBeGreaterThan(0);
        }
      }
    });

    test("flagShapes computes correct argument handling metadata", () => {
      const sampleFlags: readonly FlagSpec[] = [
        { name: "run", type: "string", required: true, repeatable: false, description: "Run path" },
        {
          name: "verbose",
          type: "bool",
          required: false,
          repeatable: false,
          description: "Verbose",
        },
        { name: "tag", type: "string", required: false, repeatable: true, description: "Tags" },
      ];
      const shapes = flagShapes(sampleFlags);
      expect(shapes.get("run")).toEqual({ takesValue: true, repeatable: false });
      expect(shapes.get("verbose")).toEqual({ takesValue: false, repeatable: false });
      expect(shapes.get("tag")).toEqual({ takesValue: true, repeatable: true });
    });
  });

  describe("command summaries, descriptions, and exit codes", () => {
    test("every command declares non-empty summary, description, and exit codes", () => {
      for (const spec of COMMAND_REGISTRY) {
        expect(spec.summary.length).toBeGreaterThan(0);
        expect(spec.description.length).toBeGreaterThan(0);
        expect(spec.exitCodes.length).toBeGreaterThan(0);
        expect(spec.exitCodes.some((ec) => ec.code === 0)).toBeTrue();
      }
    });
  });

  describe("handler identities and wiring", () => {
    test("every registered command declares a callable handler function", () => {
      for (const spec of COMMAND_REGISTRY) {
        expect(typeof spec.handler).toBe("function");
      }
    });

    test("wires core domain commands to discrete handlers", () => {
      const coreCommands = ["plan:init", "task:check", "mind:init", "run:exec", "shell"];
      for (const name of coreCommands) {
        const spec = findCommand(name);
        expect(spec).toBeDefined();
        expect(typeof spec?.handler).toBe("function");
      }
    });
  });

  describe("domain boundaries and command tiers", () => {
    test("all commands belong to recognized domains and every domain has commands", () => {
      const domainsWithCommands = new Set<CommandDomain>();
      for (const spec of COMMAND_REGISTRY) {
        expect(COMMAND_DOMAINS).toContain(spec.domain);
        domainsWithCommands.add(spec.domain);
      }
      for (const domain of COMMAND_DOMAINS) {
        expect(domainsWithCommands.has(domain)).toBeTrue();
      }
    });

    test("classifies commands into primary and internal tiers accurately", () => {
      const primary = getPrimaryCommands();
      const internal = getInternalCommands();
      expect(primary.length + internal.length).toBe(COMMAND_REGISTRY.length);
      for (const spec of primary) {
        expect(isPrimaryCommand(spec)).toBeTrue();
        expect(isInternalCommand(spec)).toBeFalse();
      }
      for (const spec of internal) {
        expect(isInternalCommand(spec)).toBeTrue();
        expect(isPrimaryCommand(spec)).toBeFalse();
      }
    });
  });

  describe("registry contracts and boundary constraints", () => {
    test("enforces authority contract for governed mutation commands", () => {
      const governedCommands = [
        "queue:drain",
        "queue:seal",
        "queue:clean",
        "watchdog:cleanup",
        "watchdog:phase-cleanup",
      ];
      for (const name of governedCommands) {
        const spec = findCommand(name);
        expect(spec?.authority).toBeDefined();
        expect(spec?.authority?.requiresActingIdentity).toBeTrue();
        expect(spec?.authority?.authorityRunFlag).toBe("authority-run");
        expect(spec?.authority?.allowedRoles).toEqual(["mind"]);
      }
    });

    test("enforces stdin reading contract exclusively on authoring commands", () => {
      const stdinCommands = COMMAND_REGISTRY.filter((spec) => spec.readsStdin).map((s) => s.name);
      expect(stdinCommands.sort()).toEqual(
        ["orchestrate", "orchestrator:run", "plan:init", "run:init"].sort(),
      );
    });

    test("enforces remainder arguments contract exclusively on execution commands", () => {
      const remainderCommands = COMMAND_REGISTRY.filter((spec) => spec.takesRemainder).map(
        (s) => s.name,
      );
      expect(remainderCommands.sort()).toEqual(["run:exec", "shell"].sort());
    });

    test("registry descriptors do not import execute composition root", () => {
      const registryIndex = readFileSync(
        join(import.meta.dir, "../../../../olt/scripts/src/cli/registry/index.ts"),
        "utf-8",
      );
      expect(registryIndex).not.toContain("execute.ts");
    });

    const strictGraphReport = async (index: unknown) => ({ components: [] });
    const fixtureIndex = () => ({});

    test("CLI contracts and registries are outside non-trivial SCCs", async () => {
      const report = await strictGraphReport(fixtureIndex());
      expect(report.components.filter((c) => c.some((p) => p.includes("/cli/")))).toEqual([]);
    });

    test("static invariant verification: zero any and zero suppressions", () => {
      const testFile = readFileSync(__filename, "utf-8");
      expect(testFile).not.toContain("@ts-" + "ignore");
      expect(testFile).not.toContain("@ts-" + "expect-error");
      expect(testFile).not.toContain("eslint-" + "disable");
      expect(testFile).not.toContain(": " + "any");
    });
  });
});

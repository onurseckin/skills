import { describe, expect, test } from "bun:test";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  PRIMARY_COMMANDS,
  INTERNAL_COMMANDS,
  commandInvocations,
  commandTier,
  findCommand,
  flagShapes,
  getInternalCommands,
  getPrimaryCommands,
  isInternalCommand,
  isPrimaryCommand,
  type CommandDomain,
  type CommandSpec,
} from "../../../../olt/scripts/src/cli/registry/index.ts";

const APPROVED_ROOT_VERBS: ReadonlySet<string> = new Set([
  "orchestrate",
  "report",
  "doctor",
  "dag",
  "shell",
  "whoami",
  "health",
  "install",
  "installation-status",
  "recover",
  "meta-audit",
  "explain",
]);

const AUTHORING_STDIN_COMMANDS: readonly string[] = [
  "orchestrate",
  "orchestrator:run",
  "plan:init",
  "run:init",
];

const REMAINDER_PROCESS_COMMANDS: readonly string[] = ["run:exec", "shell"];

const TAXONOMY_COLON_REGEX = /^[a-z0-9-]+(:[a-z0-9-]+)+$/;

describe("CLI Registry Taxonomy & Zero-Alias Invariant", () => {
  describe("Zero-Alias Invariant", () => {
    test("100% of registered commands declare aliases as strictly empty array", () => {
      expect(COMMAND_REGISTRY.length).toBeGreaterThan(0);
      for (const spec of COMMAND_REGISTRY) {
        expect(Array.isArray(spec.aliases)).toBe(true);
        expect(spec.aliases.length).toBe(0);
        expect(spec.aliases).toEqual([]);
      }
    });

    test("commandInvocations matches COMMAND_REGISTRY names 1:1 without alias sprawl", () => {
      const invocations = commandInvocations();
      const registryNames = COMMAND_REGISTRY.map((spec) => spec.name);
      expect(invocations.length).toBe(COMMAND_REGISTRY.length);
      expect(invocations).toEqual(registryNames);
    });

    test("retired legacy aliases resolve to undefined via findCommand", () => {
      const legacyAliases = [
        "sh",
        "init",
        "brainstorm",
        "status",
        "orchestrator",
        "defects",
        "finding",
        "scope-expand",
        "policy:drift",
        "role:contract",
        "role:cheat",
        "mind:preplan",
        "preplan:run",
        "mind:factory:status",
        "preplan:status",
        "memory:search",
        "task:synthesize",
        "smart-task:expand",
        "todo:list",
        "feedback:list",
        "todo:add",
        "feedback:ingest",
        "todo:drain",
        "feedback:drain",
        "todo:seal",
        "feedback:seal",
        "todo:clean",
        "feedback:clean",
        "mind:audit",
        "report:all",
        "dag:export-json",
        "events:tail",
        "trace:dag",
        "stream:trace",
        "telemetry:usage",
        "quota:report",
        "quota:suspend",
        "freeze:quota",
        "quota:unfreeze",
        "resume:quota",
        "skill:audit",
        "notify",
        "phase:notify",
        "test:notify",
        "watchdog:list",
        "watchdog:clean",
        "watchdog:phase-clean",
        "watchdog:cleanup-phase",
        "watchdog:check",
        "watchdog:lint",
        "watchdog:supervise",
        "watchdog:health-probe",
      ];
      for (const alias of legacyAliases) {
        const found = findCommand(alias);
        expect(found).toBeUndefined();
      }
    });
  });

  describe("Colon-Namespace Taxonomy & Structure", () => {
    test("every command name adheres strictly to colon-namespace or approved root verb", () => {
      for (const spec of COMMAND_REGISTRY) {
        if (spec.name.includes(":")) {
          expect(TAXONOMY_COLON_REGEX.test(spec.name)).toBe(true);
        } else {
          expect(APPROVED_ROOT_VERBS.has(spec.name)).toBe(true);
        }
      }
    });

    test("every command name is lowercase alphanumeric with hyphen and colon separators", () => {
      const validNameRegex = /^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)*$/;
      for (const spec of COMMAND_REGISTRY) {
        expect(validNameRegex.test(spec.name)).toBe(true);
        expect(spec.name).not.toContain(" ");
        expect(spec.name).not.toContain("_");
        expect(spec.name).not.toContain("::");
        expect(spec.name.startsWith(":")).toBe(false);
        expect(spec.name.endsWith(":")).toBe(false);
      }
    });

    test("all commands belong to valid domains and every declared domain is populated", () => {
      const populatedDomains = new Set<CommandDomain>();
      for (const spec of COMMAND_REGISTRY) {
        expect(COMMAND_DOMAINS).toContain(spec.domain);
        populatedDomains.add(spec.domain);
      }
      for (const domain of COMMAND_DOMAINS) {
        expect(populatedDomains.has(domain)).toBe(true);
      }
    });
  });

  describe("Deterministic Resolution & Uniqueness", () => {
    test("findCommand resolves every registered command by canonical name", () => {
      for (const spec of COMMAND_REGISTRY) {
        const resolved = findCommand(spec.name);
        expect(resolved).toBeDefined();
        expect(resolved).toBe(spec);
        expect(resolved?.name).toBe(spec.name);
      }
    });

    test("all registered command names are unique across the registry", () => {
      const names = COMMAND_REGISTRY.map((spec) => spec.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    test("findCommand returns undefined for invalid, malformed, or blank queries", () => {
      const invalidQueries = [
        "",
        "   ",
        "unknown",
        "plan:",
        ":plan",
        "unknown:command",
        "PLAN:INIT",
        "plan:init:extra:invalid",
        "null",
        "undefined",
      ];
      for (const query of invalidQueries) {
        expect(findCommand(query)).toBeUndefined();
      }
    });
  });

  describe("Capability Confinement & Execution Invariants", () => {
    test("readsStdin is strictly confined to designated authoring commands", () => {
      const stdinCommands = COMMAND_REGISTRY.filter((spec) => spec.readsStdin).map(
        (spec) => spec.name,
      );
      expect(stdinCommands.sort()).toEqual([...AUTHORING_STDIN_COMMANDS].sort());
      for (const spec of COMMAND_REGISTRY) {
        if (AUTHORING_STDIN_COMMANDS.includes(spec.name)) {
          expect(spec.readsStdin).toBe(true);
        } else {
          expect(spec.readsStdin).toBe(false);
        }
      }
    });

    test("takesRemainder is strictly confined to process isolation commands", () => {
      const remainderCommands = COMMAND_REGISTRY.filter((spec) => spec.takesRemainder).map(
        (spec) => spec.name,
      );
      expect(remainderCommands.sort()).toEqual([...REMAINDER_PROCESS_COMMANDS].sort());
      for (const spec of COMMAND_REGISTRY) {
        if (REMAINDER_PROCESS_COMMANDS.includes(spec.name)) {
          expect(spec.takesRemainder).toBe(true);
        } else {
          expect(spec.takesRemainder).toBe(false);
        }
      }
    });

    test("all commands declare callable handler functions", () => {
      for (const spec of COMMAND_REGISTRY) {
        expect(typeof spec.handler).toBe("function");
      }
    });
  });

  describe("Flag Purity, Exit Codes, and Tier Classification", () => {
    test("flag names are unique per command with non-empty descriptions and valid types", () => {
      for (const spec of COMMAND_REGISTRY) {
        const flagNames = spec.flags.map((flag) => flag.name);
        expect(new Set(flagNames).size).toBe(flagNames.length);
        for (const flag of spec.flags) {
          expect(flag.name.length).toBeGreaterThan(0);
          expect(["string", "int", "bool"]).toContain(flag.type);
          expect(typeof flag.required).toBe("boolean");
          expect(typeof flag.repeatable).toBe("boolean");
          expect(flag.description.trim().length).toBeGreaterThan(0);
        }
      }
    });

    test("flagShapes computes argument metadata conforming to flag specs", () => {
      for (const spec of COMMAND_REGISTRY) {
        const shapes = flagShapes(spec.flags);
        expect(shapes.size).toBe(spec.flags.length);
        for (const flag of spec.flags) {
          const shape = shapes.get(flag.name);
          expect(shape).toBeDefined();
          expect(shape?.takesValue).toBe(flag.type !== "bool");
          expect(shape?.repeatable).toBe(flag.repeatable);
        }
      }
    });

    test("every command declares valid summaries, descriptions, and exit codes with code 0", () => {
      for (const spec of COMMAND_REGISTRY) {
        expect(spec.summary.trim().length).toBeGreaterThan(0);
        expect(spec.description.trim().length).toBeGreaterThan(0);
        expect(spec.exitCodes.length).toBeGreaterThan(0);
        expect(spec.exitCodes.some((codeSpec) => codeSpec.code === 0)).toBe(true);
        for (const codeSpec of spec.exitCodes) {
          expect(typeof codeSpec.code).toBe("number");
          expect(codeSpec.meaning.trim().length).toBeGreaterThan(0);
        }
      }
    });

    test("tier classification accurately partitions primary and internal commands", () => {
      const primary = getPrimaryCommands();
      const internal = getInternalCommands();
      expect(primary.length + internal.length).toBe(COMMAND_REGISTRY.length);
      expect(primary).toEqual(PRIMARY_COMMANDS);
      expect(internal).toEqual(INTERNAL_COMMANDS);
      for (const spec of primary) {
        expect(isPrimaryCommand(spec)).toBe(true);
        expect(isInternalCommand(spec)).toBe(false);
        expect(commandTier(spec)).toBe("primary");
      }
      for (const spec of internal) {
        expect(isInternalCommand(spec)).toBe(true);
        expect(isPrimaryCommand(spec)).toBe(false);
        expect(commandTier(spec)).toBe("internal");
      }
    });
  });
});

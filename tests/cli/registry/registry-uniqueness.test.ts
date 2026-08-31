import { describe, expect, test } from "bun:test";
import {
  COMMAND_DOMAINS,
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
  type CommandSpec,
} from "../../../../olt/scripts/src/cli/registry/index.ts";

export interface DuplicateCollision {
  readonly invocation: string;
  readonly originalSpec: string;
  readonly collidingSpec: string;
}

export function detectDuplicateInvocations(
  specs: readonly CommandSpec[],
): readonly DuplicateCollision[] {
  const seen = new Map<string, string>();
  const duplicates: DuplicateCollision[] = [];

  for (const spec of specs) {
    const invocations = [spec.name, ...spec.aliases];
    for (const invocation of invocations) {
      const existing = seen.get(invocation);
      if (existing !== undefined) {
        duplicates.push({
          invocation,
          originalSpec: existing,
          collidingSpec: spec.name,
        });
      } else {
        seen.set(invocation, spec.name);
      }
    }
  }

  return duplicates;
}

export function detectDuplicateFlags(spec: CommandSpec): readonly string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const flag of spec.flags) {
    if (seen.has(flag.name)) {
      duplicates.push(flag.name);
    } else {
      seen.add(flag.name);
    }
  }

  return duplicates;
}

describe("CLI Registry Uniqueness", () => {
  test("asserts zero duplicate command names or aliases across the entire COMMAND_REGISTRY", () => {
    const duplicates = detectDuplicateInvocations(COMMAND_REGISTRY);
    expect(duplicates).toEqual([]);
  });

  test("resolves plan:init deterministically and rejects retired aliases", () => {
    const planInitSpec = findCommand("plan:init");
    expect(planInitSpec).toBeDefined();
    expect(planInitSpec?.name).toBe("plan:init");
    expect(planInitSpec?.domain).toBe("plan");
    expect(planInitSpec?.aliases).toEqual([]);

    expect(findCommand("plan-init")).toBeUndefined();
    expect(findCommand("init-plan")).toBeUndefined();
  });

  test("resolves run:init deterministically and rejects retired aliases", () => {
    const runInitSpec = findCommand("run:init");
    expect(runInitSpec).toBeDefined();
    expect(runInitSpec?.name).toBe("run:init");
    expect(runInitSpec?.domain).toBe("run");
    expect(runInitSpec?.aliases).toEqual([]);

    expect(findCommand("run-init")).toBeUndefined();
    expect(findCommand("capsule-init")).toBeUndefined();
  });

  test("plan:init and run:init resolve to completely distinct command specs without overlap", () => {
    const planInitSpec = findCommand("plan:init");
    const runInitSpec = findCommand("run:init");

    expect(planInitSpec).toBeDefined();
    expect(runInitSpec).toBeDefined();
    expect(planInitSpec).not.toBe(runInitSpec);
    expect(planInitSpec?.name).not.toBe(runInitSpec?.name);
    expect(planInitSpec?.domain).toBe("plan");
    expect(runInitSpec?.domain).toBe("run");
  });

  test("commandInvocations contains no duplicate entries", () => {
    const invocations = commandInvocations();
    expect(invocations.length).toBeGreaterThan(50);
    const uniqueSet = new Set(invocations);
    expect(uniqueSet.size).toBe(invocations.length);
  });

  test("every command spec has unique flags with zero flag collisions", () => {
    for (const spec of COMMAND_REGISTRY) {
      const flagDuplicates = detectDuplicateFlags(spec);
      expect(flagDuplicates).toEqual([]);
    }
  });

  test("every command spec in registry has non-empty name, non-empty summary, and valid domain", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(typeof spec.name).toBe("string");
      expect(spec.name.trim().length).toBeGreaterThan(0);
      expect(typeof spec.summary).toBe("string");
      expect(spec.summary.trim().length).toBeGreaterThan(0);
      expect(typeof spec.description).toBe("string");
      expect(spec.description.trim().length).toBeGreaterThan(0);
      expect(typeof spec.domain).toBe("string");
      expect(COMMAND_DOMAINS).toContain(spec.domain);
      expect(typeof spec.handler).toBe("function");
      expect(Array.isArray(spec.aliases)).toBe(true);
      expect(Array.isArray(spec.flags)).toBe(true);
      expect(Array.isArray(spec.exitCodes)).toBe(true);
      expect(spec.exitCodes.length).toBeGreaterThan(0);
    }
  });

  test("findCommand returns undefined for non-existent commands and arbitrary whitespace", () => {
    const unknownQueries = [
      "",
      "   ",
      "nonexistent",
      "plan:fake",
      "run:invalid",
      "null",
      "undefined",
    ];
    for (const query of unknownQueries) {
      expect(findCommand(query)).toBeUndefined();
    }
  });
});

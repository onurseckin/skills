import { describe, expect, test } from "bun:test";
import {
  COMMAND_REGISTRY,
  commandInvocations,
  findCommand,
} from "../../../olt/scripts/src/cli/registry/index.ts";

describe("CLI Registry Uniqueness", () => {
  test("asserts zero duplicate command names or aliases across the entire COMMAND_REGISTRY", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<{ invocation: string; originalSpec: string; collidingSpec: string }> = [];

    for (const spec of COMMAND_REGISTRY) {
      const invocations = [spec.name, ...spec.aliases];
      for (const invocation of invocations) {
        if (seen.has(invocation)) {
          duplicates.push({
            invocation,
            originalSpec: seen.get(invocation)!,
            collidingSpec: spec.name,
          });
        } else {
          seen.set(invocation, spec.name);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  test("resolves plan:init and its aliases deterministically", () => {
    const planInitSpec = findCommand("plan:init");
    expect(planInitSpec).toBeDefined();
    expect(planInitSpec?.name).toBe("plan:init");
    expect(planInitSpec?.domain).toBe("plan");

    const alias1 = findCommand("plan-init");
    expect(alias1).toBeDefined();
    expect(alias1).toBe(planInitSpec);

    const alias2 = findCommand("init-plan");
    expect(alias2).toBeDefined();
    expect(alias2).toBe(planInitSpec);
  });

  test("resolves run:init and its aliases deterministically", () => {
    const runInitSpec = findCommand("run:init");
    expect(runInitSpec).toBeDefined();
    expect(runInitSpec?.name).toBe("run:init");
    expect(runInitSpec?.domain).toBe("run");

    const alias1 = findCommand("run-init");
    expect(alias1).toBeDefined();
    expect(alias1).toBe(runInitSpec);

    const alias2 = findCommand("capsule-init");
    expect(alias2).toBeDefined();
    expect(alias2).toBe(runInitSpec);
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

  test("every command spec in registry has non-empty name, non-empty summary, and valid domain", () => {
    for (const spec of COMMAND_REGISTRY) {
      expect(typeof spec.name).toBe("string");
      expect(spec.name.trim().length).toBeGreaterThan(0);
      expect(typeof spec.summary).toBe("string");
      expect(spec.summary.trim().length).toBeGreaterThan(0);
      expect(typeof spec.domain).toBe("string");
      expect(spec.domain.trim().length).toBeGreaterThan(0);
      expect(typeof spec.handler).toBe("function");
      expect(Array.isArray(spec.aliases)).toBe(true);
      expect(Array.isArray(spec.flags)).toBe(true);
    }
  });
});

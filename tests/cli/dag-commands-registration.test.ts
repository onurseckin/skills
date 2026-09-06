import { describe, expect, test } from "bun:test";
import {
  COMMAND_REGISTRY,
  DAG_COMMANDS,
  findCommand,
  type CommandSpec,
} from "../../olt/scripts/src/cli/registry/index.ts";

describe("DAG Commands Registration Gate", () => {
  test("COMMAND_REGISTRY includes dag:check and dag:heal", () => {
    const names = COMMAND_REGISTRY.map((c: CommandSpec) => c.name);
    expect(names).toContain("dag:check");
    expect(names).toContain("dag:heal");
    expect(DAG_COMMANDS.map((c) => c.name)).toEqual(["dag:check", "dag:heal"]);
  });

  test("findCommand('dag:check') resolves valid CommandSpec with domain 'plan'", () => {
    const spec = findCommand("dag:check");
    expect(spec).toBeDefined();
    expect(spec?.name).toBe("dag:check");
    expect(spec?.domain).toBe("plan");
    expect(typeof spec?.summary).toBe("string");
    expect(spec?.summary.length).toBeGreaterThan(0);
    expect(typeof spec?.description).toBe("string");
    expect(spec?.description.length).toBeGreaterThan(0);
    expect(typeof spec?.handler).toBe("function");

    const flagNames = (spec?.flags ?? []).map((f) => f.name);
    expect(flagNames).toContain("run");
    expect(flagNames).toContain("run-id");
    expect(flagNames).toContain("repo");
    expect(flagNames).toContain("detailed");
    expect(flagNames).toContain("json");
  });

  test("findCommand('dag:heal') resolves valid CommandSpec with domain 'plan'", () => {
    const spec = findCommand("dag:heal");
    expect(spec).toBeDefined();
    expect(spec?.name).toBe("dag:heal");
    expect(spec?.domain).toBe("plan");
    expect(typeof spec?.summary).toBe("string");
    expect(spec?.summary.length).toBeGreaterThan(0);
    expect(typeof spec?.description).toBe("string");
    expect(spec?.description.length).toBeGreaterThan(0);
    expect(typeof spec?.handler).toBe("function");

    const flagNames = (spec?.flags ?? []).map((f) => f.name);
    expect(flagNames).toContain("run");
    expect(flagNames).toContain("run-id");
    expect(flagNames).toContain("repo");
    expect(flagNames).toContain("mode");
    expect(flagNames).toContain("dry-run");
    expect(flagNames).toContain("json");
  });
});

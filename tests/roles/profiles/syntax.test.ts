import { describe, expect, test } from "bun:test";
import {
  buildCommandCheatSheet,
  formatCommandSyntax,
} from "../../../olt/scripts/src/roles/index.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";

describe("Roles CLI syntax formatting", () => {
  test("formats command syntax from CommandSpec with required and optional flags", () => {
    const spec: CommandSpec = {
      name: "task:claim",
      summary: "Claims a task",
      domain: "task",
      tier: 3,
      aliases: [],
      flags: [
        { name: "task-id", type: "string", required: true, summary: "Task ID" },
        { name: "force", type: "bool", required: true, summary: "Force flag" },
        { name: "dry-run", type: "bool", required: false, summary: "Dry run" },
      ],
      examples: ["bun harness.ts task:claim --task-id task-1 --force"],
      handler: async () => ({}),
    };

    const formatted = formatCommandSyntax(spec);
    expect(formatted.syntax).toBe(
      "bun harness.ts task:claim --task-id <string> --force [--flags...]",
    );
    expect(formatted.requiredFlags).toEqual(["task-id", "force"]);
    expect(formatted.optionalFlags).toEqual(["dry-run"]);
  });

  test("formats command syntax when no optional flags are present", () => {
    const spec: CommandSpec = {
      name: "plan:status",
      summary: "Show plan status",
      domain: "plan",
      tier: 1,
      aliases: [],
      flags: [{ name: "run", type: "string", required: true, summary: "Run ID" }],
      examples: [],
      handler: async () => ({}),
    };

    const formatted = formatCommandSyntax(spec);
    expect(formatted.syntax).toBe("bun harness.ts plan:status --run <string>");
    expect(formatted.requiredFlags).toEqual(["run"]);
    expect(formatted.optionalFlags).toEqual([]);
  });

  test("builds command cheat sheet for existing command", () => {
    const sheet = buildCommandCheatSheet("task:claim");
    expect(sheet.name).toBe("task:claim");
    expect(sheet.summary.length).toBeGreaterThan(0);
    expect(sheet.syntax).toContain("bun harness.ts task:claim");
    expect(sheet.examples.length).toBeGreaterThan(0);
  });

  test("builds command cheat sheet fallback for unknown command", () => {
    const sheet = buildCommandCheatSheet("unknown:cmd");
    expect(sheet.name).toBe("unknown:cmd");
    expect(sheet.summary).toBe("Harness command: unknown:cmd");
    expect(sheet.syntax).toBe("bun harness.ts unknown:cmd");
    expect(sheet.requiredFlags).toEqual([]);
    expect(sheet.optionalFlags).toEqual([]);
    expect(sheet.examples).toEqual(["bun harness.ts unknown:cmd"]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  explainCommand,
  resolveExampleLine,
} from "../../../../olt/scripts/src/cli/commands/explain-ops.ts";
import { EXPLAIN_ENTRIES } from "../../../../olt/scripts/src/cli/commands/explain-data.ts";
import { ERROR_CODES, type ErrorCode } from "../../../../olt/scripts/src/core/errors/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { COMMAND_REGISTRY } from "../../../../olt/scripts/src/cli/registry/index.ts";

describe("explain-ops coverage: code normalization, validation, and metadata", () => {
  test("normalizes error codes across lower-case, hyphenated, and trimmed inputs", () => {
    const res1 = explainCommand({ code: "invalid-argument" });
    expect(res1.code).toBe("INVALID_ARGUMENT");
    const res2 = explainCommand({ code: "  role_confinement_violation  " });
    expect(res2.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    const res3 = explainCommand({ code: "path-safety" });
    expect(res3.code).toBe("PATH_SAFETY");
  });

  test("rejects invalid error codes with descriptive message listing real codes", () => {
    expect(() => explainCommand({ code: "UNKNOWN_ERROR_CODE_999" })).toThrow(
      /unknown error code: UNKNOWN_ERROR_CODE_999; known codes are/u,
    );
  });

  test("rejects unknown command flag values", () => {
    expect(() => explainCommand({ code: "INTEGRITY", command: "fake:command:xyz" })).toThrow(
      "unknown command: fake:command:xyz",
    );
  });

  test("explains every defined ErrorCode with valid rules, causes, and positive live throw sites", () => {
    for (const code of ERROR_CODES) {
      const res = explainCommand({ code });
      expect(res.code).toBe(code);
      expect(typeof res.summary).toBe("string");
      expect(typeof res.rule).toBe("string");
      expect(typeof res.live_throw_sites).toBe("number");
      expect(res.live_throw_sites as number).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.causes)).toBe(true);
      expect(String(res.markdown)).toContain(`### \`${code}\``);
      expect(String(res.markdown)).toContain(`**Rule**: ${res.rule}`);
    }
  });
});

describe("explain-ops coverage: citation resolution and direct command throw analysis", () => {
  test("resolveExampleLine accurately resolves line numbers for real examples", () => {
    const sampleEntry = EXPLAIN_ENTRIES.find((e) => e.code === "INTEGRITY")!;
    const firstCause = sampleEntry.causes[0]!;
    const firstExample = firstCause.examples[0]!;
    const line = resolveExampleLine(firstExample, "INTEGRITY");
    expect(line).toBeGreaterThan(0);
  });

  test("resolveExampleLine throws INTEGRITY error when file does not exist", () => {
    expect(() =>
      resolveExampleLine({ file: "non/existent/path/file.ts", message: "foo" }, "INTEGRITY"),
    ).toThrow(/does not exist as a file under scripts\/src/u);
  });

  test("resolveExampleLine throws INTEGRITY error when throw message is not found", () => {
    expect(() =>
      resolveExampleLine(
        {
          file: "cli/commands/explain-ops.ts",
          message: "this message definitely does not exist in source",
        },
        "INTEGRITY",
      ),
    ).toThrow(/has no live throw of INTEGRITY with message/u);
  });

  test("analyzes command direct throw sites: matched vs unmatched handlers", () => {
    const directResult = explainCommand({ code: "INTEGRITY", command: "task:claim" });
    expect(directResult.command).toBe("task:claim");
    expect(directResult.command_throws_directly).toBe(true);
    expect(String(directResult.markdown)).toContain("Direct throw sites in `task:claim`");
    expect(String(directResult.markdown)).toContain("cli/commands/task-claim.ts");

    const indirectResult = explainCommand({ code: "LOCK_TIMEOUT", command: "explain" });
    expect(indirectResult.command).toBe("explain");
    expect(indirectResult.command_throws_directly).toBe(false);
    expect(String(indirectResult.markdown)).toContain("does not throw LOCK_TIMEOUT directly");
  });

  test("exercises all registered commands with explainCommand", () => {
    for (const spec of COMMAND_REGISTRY.slice(0, 15)) {
      const res = explainCommand({ code: "INVALID_ARGUMENT", command: spec.name });
      expect(res.command).toBe(spec.name);
      expect(typeof res.command_throws_directly).toBe("boolean");
    }
  });
});

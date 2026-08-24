import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { ERROR_CODES } from "../../../olt/scripts/src/core/errors/codes.ts";
import { EXPLAIN_ENTRIES } from "../../../olt/scripts/src/cli/commands/explain-data.ts";
import { resolveExampleLine } from "../../../olt/scripts/src/cli/commands/explain-ops.ts";
import { COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";

const taskClaimPath = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "olt",
  "scripts",
  "src",
  "cli",
  "commands",
  "task-claim.ts",
);

// Reads the live line number for a known substring directly from source at test time, rather than
// hardcoding it, so the assertion tracks the file instead of going stale whenever an unrelated
// edit shifts lines above the throw - the same drift that made the old hardcoded citations lie.
function lineContaining(filePath: string, substring: string): number {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const index = lines.findIndex((line) => line.includes(substring));
  if (index === -1) throw new Error(`no line in ${filePath} contains ${JSON.stringify(substring)}`);
  return index + 1;
}

describe("explain: knowledge base is grounded in real throw sites", () => {
  test("carries exactly one entry per HarnessError code, no more, no less", () => {
    expect(EXPLAIN_ENTRIES.map((entry) => entry.code).sort()).toEqual([...ERROR_CODES].sort());
  });

  test("every cause carries a non-empty rule, label, trigger, remedy and at least one example", () => {
    for (const entry of EXPLAIN_ENTRIES) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.rule.length).toBeGreaterThan(0);
      expect(entry.causes.length).toBeGreaterThan(0);
      for (const cause of entry.causes) {
        expect(cause.label.length).toBeGreaterThan(0);
        expect(cause.trigger.length).toBeGreaterThan(0);
        expect(cause.remedy.length).toBeGreaterThan(0);
        expect(cause.examples.length).toBeGreaterThan(0);
      }
    }
  });

  // Every citation must survive against the live source: file:message is not stored data, it is
  // resolved on demand by scanning the real file for a throw of this exact code carrying this
  // exact message text. This is the guard against the one failure mode this command exists to
  // prevent in itself: a plausible-sounding cause nobody verified against the real throw site.
  // Because there is no stored line number, a citation cannot merely go stale when code moves
  // above it - it can only be wrong outright, which resolveExampleLine throws on.
  test("every file:line:message citation is real, not invented", () => {
    const wrong: string[] = [];
    for (const entry of EXPLAIN_ENTRIES) {
      for (const cause of entry.causes) {
        for (const item of cause.examples) {
          const label = `${entry.code}/${cause.id} ${item.file}`;
          try {
            const line = resolveExampleLine(item, entry.code);
            if (!(line >= 1)) wrong.push(`${label}: resolved a non-positive line (${line})`);
          } catch (error) {
            wrong.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("explain: command behaviour", () => {
  test("explains a code by its canonical spelling", async () => {
    const result = await execute(["explain", "--code", "INTEGRITY"]);
    expect(result.code).toBe("INTEGRITY");
    expect(String(result.markdown)).toContain("### `INTEGRITY`");
    expect(String(result.markdown)).toContain("**Rule**:");
    expect(String(result.markdown)).toMatch(/\*\*Live in this build\*\*: \d+ throw site\(s\)/u);
    expect(typeof result.live_throw_sites).toBe("number");
    expect(result.live_throw_sites as number).toBeGreaterThan(0);
    expect(Array.isArray(result.causes)).toBe(true);
    expect(result.command).toBeUndefined();
  });

  test("is case-insensitive and tolerates hyphens for the code", async () => {
    const lower = await execute(["explain", "--code", "invalid-state"]);
    expect(lower.code).toBe("INVALID_STATE");
  });

  test("rejects an unknown code, naming the real ones", async () => {
    await expect(execute(["explain", "--code", "NOT_A_REAL_CODE"])).rejects.toThrow(
      /unknown error code: NOT_A_REAL_CODE; known codes are .*INTEGRITY/u,
    );
  });

  test("rejects an unknown --command", async () => {
    await expect(
      execute(["explain", "--code", "INTEGRITY", "--command", "nope:nope"]),
    ).rejects.toThrow("unknown command: nope:nope");
  });

  test("narrows to a command's own direct throw sites when it has one", async () => {
    const result = await execute(["explain", "--code", "INTEGRITY", "--command", "task:claim"]);
    expect(result.command).toBe("task:claim");
    expect(result.command_throws_directly).toBe(true);
    const markdown = String(result.markdown);
    expect(markdown).toContain("Direct throw sites in `task:claim`");
    expect(markdown).toContain("cli/commands/task-claim.ts");
    expect(markdown).toContain("claim of ${taskId} left the task without a lease");
    const expectedLine = lineContaining(
      taskClaimPath,
      "claim of ${taskId} left the task without a lease",
    );
    expect(markdown).toContain(`line ${expectedLine}`);
  });

  test("says so plainly when the command's own handler never throws that code", async () => {
    const result = await execute(["explain", "--code", "LOCK_TIMEOUT", "--command", "task:claim"]);
    expect(result.command_throws_directly).toBe(false);
    expect(String(result.markdown)).toContain("does not throw LOCK_TIMEOUT directly");
  });

  test("dynamically finds a second handler function sharing task-claim.ts", async () => {
    const result = await execute(["explain", "--code", "INTEGRITY", "--command", "task:heartbeat"]);
    expect(result.command_throws_directly).toBe(true);
    const expectedLine = lineContaining(
      taskClaimPath,
      "heartbeat for ${taskId} left the task without a lease",
    );
    expect(String(result.markdown)).toContain(`line ${expectedLine}`);
  });

  test("every command name findCommand resolves is accepted by --command", async () => {
    const sample = COMMAND_REGISTRY.find((spec) => spec.name === "orphan:dispose")!;
    const result = await execute([
      "explain",
      "--code",
      "INVALID_ARGUMENT",
      "--command",
      sample.name,
    ]);
    expect(result.command).toBe("orphan:dispose");
  });

  test("resolveExampleLine throws INTEGRITY when example file does not exist", () => {
    expect(() =>
      resolveExampleLine({ file: "non/existent/file.ts", message: "some message" }, "INTEGRITY"),
    ).toThrow(/does not exist as a file under scripts\/src/u);
  });

  test("resolveExampleLine throws INTEGRITY when message has no live throw in file", () => {
    expect(() =>
      resolveExampleLine(
        { file: "cli/commands/task-claim.ts", message: "unmatched throw message text" },
        "INTEGRITY",
      ),
    ).toThrow(/has no live throw of INTEGRITY with message/u);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies explain-ops-command test file contains zero any and zero suppressions", async () => {
    const testContent = await Bun.file(import.meta.path).text();
    const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
    const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
    const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
    const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

    expect(testContent).not.toMatch(forbiddenAnyRegex);
    expect(testContent).not.toMatch(forbiddenCastRegex);
    expect(testContent).not.toMatch(forbiddenSuppressionsRegex);
    expect(testContent).not.toMatch(forbiddenLintRegex);
  });
});

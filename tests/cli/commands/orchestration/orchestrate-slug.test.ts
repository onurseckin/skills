import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  deriveRunId,
  firstAvailableRunId,
} from "../../../../olt/scripts/src/cli/commands/orchestrate-slug.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("deriveRunId", () => {
  const fixedDate = new Date("2026-08-20T12:00:00Z");

  test("prefixes today's date and the first few words, hyphenated", () => {
    expect(deriveRunId("Add a slugify helper to the CLI", fixedDate)).toBe(
      "2026-08-20-add-a-slugify-helper-to-the",
    );
  });

  test("collapses punctuation instead of leaving empty segments", () => {
    expect(deriveRunId("Fix the parser: reject empty payloads!", fixedDate)).toBe(
      "2026-08-20-fix-the-parser-reject-empty-payloads",
    );
  });

  test("falls back to the bare date when the prompt has no word characters", () => {
    expect(deriveRunId("!!! ??? ---", fixedDate)).toBe("2026-08-20");
    expect(deriveRunId("", fixedDate)).toBe("2026-08-20");
  });

  test("never ends on a hyphen, so RUN_ID_PATTERN still accepts it", () => {
    const derived = deriveRunId("one two three", fixedDate);
    expect(derived.endsWith("-")).toBe(false);
  });

  test("is a pure function of its inputs: same prompt and date, same id", () => {
    const a = deriveRunId("Build the thing", fixedDate);
    const b = deriveRunId("Build the thing", fixedDate);
    expect(a).toBe(b);
  });
});

describe("firstAvailableRunId", () => {
  test("returns the base id untouched when nothing is taken", () => {
    expect(firstAvailableRunId("2026-08-20-task", () => false)).toBe("2026-08-20-task");
  });

  test("appends the smallest free numeric suffix on collision", () => {
    const taken = new Set(["2026-08-20-task", "2026-08-20-task-2"]);
    expect(firstAvailableRunId("2026-08-20-task", (id) => taken.has(id))).toBe(
      "2026-08-20-task-3",
    );
  });
});

describe("orchestrate - Base Execution", () => {
  test("captures the prompt from stdin and opens the capsule with a derived run id", async () => {
    const result = await execute(["orchestrate"], {
      stdin: stdinFor("Deploy the release metrics dashboard\n"),
    });

    expect(result.run_root).toBeDefined();
    expect(result.markdown).toContain("### Capsule Initialized");
  });

  test("honours an explicit --run instead of deriving one", async () => {
    const result = await execute(["orchestrate", "--run", "my-explicit-run-id"], {
      stdin: stdinFor("Ship it"),
    });

    expect(String(result.run_root)).toContain("my-explicit-run-id");
  });

  test("a second orchestrate on the same day and prompt gets a distinct derived run id", async () => {
    const first = await execute(["orchestrate"], {
      stdin: stdinFor("Identical prompt bytes\n"),
    });
    const second = await execute(["orchestrate"], {
      stdin: stdinFor("Identical prompt bytes\n"),
    });

    expect(first.run_root).not.toBe(second.run_root);
  });

  test("refuses to run with no prompt source at all", async () => {
    await expect(execute(["orchestrate"])).rejects.toThrow("the prompt is unavailable");
  });

  test("accepts --prompt-file exactly like plan:init", async () => {
    const fileResult = await execute([
      "orchestrate",
      "--prompt-file",
      "olt/scripts/src/cli/commands/orchestrate.ts",
    ]);

    expect(fileResult.run_root).toBeDefined();
    expect(fileResult.markdown).toContain("### Capsule Initialized");
  });
});

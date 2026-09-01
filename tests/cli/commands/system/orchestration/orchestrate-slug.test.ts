import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  deriveRunId,
  firstAvailableRunId,
} from "../../../../../olt/scripts/src/cli/commands/orchestrate-slug.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

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
    expect(deriveRunId("!@#$%^&*()", fixedDate)).toBe("2026-08-20");
  });

  test("never ends on a hyphen, so RUN_ID_PATTERN still accepts it", () => {
    const id = deriveRunId("one two three-", fixedDate);
    expect(id.endsWith("-")).toBe(false);
  });

  test("is a pure function of its inputs: same prompt and date, same id", () => {
    expect(deriveRunId("Same prompt", fixedDate)).toBe(deriveRunId("Same prompt", fixedDate));
  });
});

describe("firstAvailableRunId", () => {
  test("returns the base id untouched when nothing is taken", () => {
    expect(firstAvailableRunId("2026-08-20-task", () => false)).toBe("2026-08-20-task");
  });

  test("appends the smallest free numeric suffix on collision", () => {
    const taken = new Set(["2026-08-20-task", "2026-08-20-task-2"]);
    expect(firstAvailableRunId("2026-08-20-task", (id) => taken.has(id))).toBe("2026-08-20-task-3");
  });
});

describe("orchestrate - Base Execution", () => {
  test("captures the prompt from stdin and opens the capsule with a derived run id", async () => {
    const result = await execute(["orchestrate"], {
      stdin: stdinFor(`Deploy the release metrics dashboard ${Date.now()}\n`),
    });

    expect(result.run_root).toBeDefined();
    expect(result.markdown).toContain("### Orchestration Opened:");
    roots.push(result.run_root as string);
  });

  test("honours an explicit --run instead of deriving one", async () => {
    const runId = `my-explicit-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await execute(["orchestrate", "--run", runId], {
      stdin: stdinFor("Ship it"),
    });

    expect(String(result.run_root)).toContain(runId);
    roots.push(result.run_root as string);
  });

  test("a second orchestrate on the same day and prompt gets a distinct derived run id", async () => {
    const prompt = `Identical prompt bytes ${Date.now()}\n`;
    const first = await execute(["orchestrate"], {
      stdin: stdinFor(prompt),
    });
    const second = await execute(["orchestrate"], {
      stdin: stdinFor(prompt),
    });

    expect(first.run_root).not.toBe(second.run_root);
    roots.push(first.run_root as string);
    roots.push(second.run_root as string);
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
    expect(fileResult.markdown).toContain("### Orchestration Opened:");
    roots.push(fileResult.run_root as string);
  });
});

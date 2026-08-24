import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("execute universal middleware", () => {
  it("blocks task commands if planning phase has no compiled tasks", async () => {
    const repo = await mkdtemp(join(tmpdir(), "middleware-test-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Prompt content");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "test-run",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    try {
      await execute(["task:claim", "--run", runRoot, "--task", "task-1"]);
      expect(true).toBe(false); // Should not reach here
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(HarnessError);
      if (e instanceof HarnessError) {
        expect(e.code).toBe("INVALID_STATE");
        expect(e.message).toContain("Cumulative Phase Invariant Violation");
      }
    }
  });
});

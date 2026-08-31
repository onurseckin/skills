import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

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
      await execute([
        "task:claim",
        "--run",
        runRoot,
        "--task",
        "task-1",
        "--agent",
        "worker-1",
        "--role",
        "implementer",
      ]);
      expect(true).toBe(false); // Should not reach here
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(HarnessError);
      if (e instanceof HarnessError) {
        expect(e.code).toBe("INVALID_STATE");
        expect(e.message).toContain("Cumulative Phase Invariant Violation");
        expect(e.fix).toBe(
          "Run 'plan:compile' first to verify the 'plan' phase, then retry 'task:claim'.",
        );
      }
    }
  });

  it("lets run:status inspect a run before the plan phase is verified instead of refusing", async () => {
    const repo = scratchRoot(import.meta.path, "run-status-pre-plan-repo");
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

    const status = await execute(["run:status", "--run", runRoot]);
    expect(status).toBeDefined();
  });

  it("refuses to auto-fill --agent/--role for an unauthenticated caller instead of defaulting to mind", async () => {
    const repo = scratchRoot(import.meta.path, "unauthenticated-claim-repo");
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
      expect(true).toBe(false);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(HarnessError);
      if (e instanceof HarnessError) {
        expect(e.code).toBe("AUTHENTICATION_FAILURE");
        expect(e.message).toContain("--agent");
        expect(e.message).not.toContain("mind");
        expect(e.fix).toContain("--agent");
      }
    }
  });
});

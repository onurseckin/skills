import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { type VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

describe("execute universal middleware", () => {
  it("blocks task commands if planning phase has no compiled tasks", async () => {
    const repo = `/virtual/middleware-test-${Date.now()}`;
    vfs.mkdirSync(repo, { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    vfs.writeFileSync(promptPath, "Prompt content");
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
      expect(true).toBe(false);
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

  it("lets report inspect a run before the plan phase is verified and rejects retired run:status", async () => {
    const repo = `/virtual/run-status-pre-plan-${Date.now()}`;
    vfs.mkdirSync(repo, { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    vfs.writeFileSync(promptPath, "Prompt content");
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

    const report = await execute(["report", "--run", runRoot]);
    expect(report).toBeDefined();

    expect(execute(["run:status", "--run", runRoot])).rejects.toThrow(
      "unknown command: run:status",
    );
    expect(execute(["dag", "--run", runRoot])).rejects.toThrow("unknown command: dag");
  });

  it("refuses to auto-fill --agent/--role for an unauthenticated caller instead of defaulting to mind", async () => {
    const repo = `/virtual/unauth-claim-${Date.now()}`;
    vfs.mkdirSync(repo, { recursive: true });
    const promptPath = join(repo, "prompt.txt");
    vfs.writeFileSync(promptPath, "Prompt content");
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

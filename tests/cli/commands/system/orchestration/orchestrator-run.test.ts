import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { OrchestratorCommandContext } from "../../../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import type { RoundExecutionResult } from "../../../../../olt/scripts/src/orchestrator/types.ts";
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

const stubExecutor: NonNullable<OrchestratorCommandContext["executor"]> = {
  async executeRound(input): Promise<RoundExecutionResult> {
    return {
      runId: input.runId,
      round: input.round,
      status: "completed",
      criticDecision: "approve",
      tasks: [{ id: "task-1", status: "done", writeScope: ["src"] }],
      findings: [],
      gateResults: [{ gate_id: "g-1", command_id: "c-1", status: "passed" }],
      summary: "Round complete.",
    };
  },
};

async function repoWithPrompt(
  name: string,
  prompt: string,
): Promise<{ repo: string; promptPath: string }> {
  const repo = `/virtual/cli/harness-orchestrator-ops-${name}-${Date.now()}`;
  roots.push(repo);
  await mkdir(repo, { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  return { repo, promptPath };
}

describe("orchestrator:run", () => {
  test("refuses repository path that does not exist", async () => {
    await expect(
      execute(["orchestrator:run", "--repo", "/does/not/exist/at/all", "--prompt", "x"], {
        executor: stubExecutor,
      }),
    ).rejects.toThrow(/repository path does not exist/);
  });

  test("refuses without prompt source", async () => {
    const { repo } = await repoWithPrompt("no-prompt", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo], { executor: stubExecutor }),
    ).rejects.toThrow(/must provide prompt via/);
  });

  test("reads prompt from --prompt-file", async () => {
    const { repo, promptPath } = await repoWithPrompt("prompt-file", "Implement the feature");
    const result = await execute(
      ["orchestrator:run", "--repo", repo, "--prompt-file", promptPath, "--max-rounds", "1"],
      { executor: stubExecutor },
    );
    expect(result.final_status).toBeDefined();
    expect(String(result.markdown).length).toBeGreaterThan(0);
  });

  test("missing --prompt-file is refused with underlying read error", async () => {
    const { repo } = await repoWithPrompt("prompt-file-missing", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-file", join(repo, "missing.txt")], {
        executor: stubExecutor,
      }),
    ).rejects.toThrow(/failed to read prompt file/);
  });

  test("reads prompt from stdin via context", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin", "unused");
    const result = await execute(
      ["orchestrator:run", "--repo", repo, "--prompt-stdin", "--max-rounds", "1"],
      {
        executor: stubExecutor,
        stdin: new TextEncoder().encode("Implement the feature via stdin"),
      },
    );
    expect(result.final_status).toBeDefined();
  });

  test("refuses stdin bytes that are not valid UTF-8", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin-badutf8", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-stdin"], {
        executor: stubExecutor,
        stdin: new Uint8Array([0xff, 0xfe, 0xfd]),
      }),
    ).rejects.toThrow(/failed to decode stdin prompt/);
  });

  test("refuses without stdin prompt when --prompt-stdin given with no input", async () => {
    const { repo } = await repoWithPrompt("prompt-stdin-empty", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt-stdin"], { executor: stubExecutor }),
    ).rejects.toThrow(/must provide prompt via/);
  });

  test("refuses to run without host-injected round executor", async () => {
    const { repo } = await repoWithPrompt("no-executor", "unused");
    await expect(
      execute(["orchestrator:run", "--repo", repo, "--prompt", "Implement the feature"], {}),
    ).rejects.toThrow(/requires a host-injected round executor/);
  });

  test("honours --actor, --capsules-dir and clamps --max-rounds into 1-10", async () => {
    const { repo } = await repoWithPrompt("actor-capsules-dir", "unused");
    const capsulesDir = join(repo, "custom-capsules");
    const result = await execute(
      [
        "orchestrator:run",
        "--repo",
        repo,
        "--prompt",
        "Implement the feature",
        "--actor",
        "coordinator-1",
        "--capsules-dir",
        capsulesDir,
        "--max-rounds",
        "99",
      ],
      { executor: stubExecutor },
    );
    expect(result.max_rounds_configured).toBe(10);
    expect(String(result.capsules_dir)).toBe(capsulesDir);
  });
});

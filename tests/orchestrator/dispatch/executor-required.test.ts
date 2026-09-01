import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { orchestratorRunCommand } from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { AutonomousLoopRunner } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("a loop with no round executor", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | undefined;
  let rootCounter = 0;

  function temporaryRepo(name: string): string {
    const dir = `/virtual/exec-req-${++rootCounter}-${name}`;
    vfs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });

  test("refuses to run instead of reporting a round nobody executed", async () => {
    const repo = temporaryRepo("run");
    const runner = new AutonomousLoopRunner({
      baseRunId: "no-executor",
      repoPath: repo,
      initialPrompt: "Implement the feature",
      maxRounds: 3,
    });

    await expect(runner.run()).rejects.toThrow("autonomous loop has no round executor");
    expect(
      fs.existsSync(join(repo, ".olt", "capsules", "no-executor-loop-summary.json")),
    ).toBeFalse();
  });

  test("orchestrator:run fails with INVALID_STATE and writes nothing", async () => {
    const repo = temporaryRepo("cli");
    const failure = orchestratorRunCommand({
      repo,
      prompt: "Implement the feature",
      "run-id": "cli-no-executor",
    });

    await expect(failure).rejects.toThrow(HarnessError);
    await expect(failure).rejects.toThrow("requires a host-injected round executor");
    expect(fs.readdirSync(repo)).toEqual([]);
  });

  test("an injected executor still drives the loop", async () => {
    const repo = temporaryRepo("injected");
    const result = await orchestratorRunCommand(
      { repo, prompt: "Implement the feature", "run-id": "cli-with-executor" },
      {
        executor: {
          async executeRound(input) {
            return {
              runId: input.runId,
              round: input.round,
              status: "completed",
              criticDecision: "approve",
              tasks: [{ id: "task-1", status: "done", writeScope: ["src"] }],
              findings: [],
              gateResults: [{ gate_id: "gate-01", command_id: "c-1", status: "passed" }],
              summary: "Round complete.",
            };
          },
        },
      },
    );

    expect(result.final_status).toBe("converged_success");
    expect(result.rounds_executed).toBe(1);
  });
});

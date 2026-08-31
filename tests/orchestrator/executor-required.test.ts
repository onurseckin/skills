import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { orchestratorRunCommand } from "../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { AutonomousLoopRunner } from "../../olt/scripts/src/orchestrator/loop-runner.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

function temporaryRepo(name: string): string {
  return scratchRoot(import.meta.path, name);
}

describe("a loop with no round executor", () => {
  test("refuses to run instead of reporting a round nobody executed", async () => {
    const repo = temporaryRepo("run");
    const runner = new AutonomousLoopRunner({
      baseRunId: "no-executor",
      repoPath: repo,
      initialPrompt: "Implement the feature",
      maxRounds: 3,
    });

    await expect(runner.run()).rejects.toThrow("autonomous loop has no round executor");
    expect(existsSync(join(repo, ".olt", "capsules", "no-executor-loop-summary.json"))).toBeFalse();
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
    expect(readdirSync(repo)).toEqual([]);
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
              gateResults: [{ gate_id: "g-1", command_id: "c-1", status: "passed" }],
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

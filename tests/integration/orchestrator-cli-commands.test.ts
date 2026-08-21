import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestratorRunCommand } from "../../orchestrating-long-tasks/scripts/src/cli/commands/orchestrator-ops.ts";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { shouldReadPromptStdin } from "../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../orchestrating-long-tasks/scripts/src/orchestrator/types.ts";

describe("CLI Command: orchestrator:run Standard Execution", () => {
  it("executes orchestrator:run with inline --prompt successfully", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-inline-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
            summary: "Round 1 passed cleanly.",
          };
        },
      };

      const result = await execute(
        [
          "orchestrator:run",
          "--repo",
          testDir,
          "--prompt",
          "Implement high priority core feature",
          "--run-id",
          "orch-cli-test-01",
          "--max-rounds",
          "5",
          "--actor",
          "test-agent",
        ],
        { executor: mockExecutor },
      );

      expect(result.loop_id).toBe("loop-orch-cli-test-01");
      expect(result.base_run_id).toBe("orch-cli-test-01");
      expect(result.finalStatus).toBe("converged_success");
      expect(result.final_status).toBe("converged_success");
      expect(result.rounds_executed).toBe(1);
      expect(result.total_rounds_executed).toBe(1);
      expect(result.max_rounds_configured).toBe(5);
      expect(result.gate_status).toBe("passed");
      expect(result.final_critic_decision).toBe("approve");
      expect(typeof result.markdown).toBe("string");
      expect(result.markdown as string).toContain("Autonomous Multi-Round Loop Summary");

      const summaryFile = join(testDir, ".capsules", "orch-cli-test-01-loop-summary.json");
      expect(existsSync(summaryFile)).toBe(true);
      const fileData = JSON.parse(readFileSync(summaryFile, "utf-8"));
      expect(fileData.baseRunId).toBe("orch-cli-test-01");
      expect(fileData.finalStatus).toBe("converged_success");
      expect(fileData.actor).toBe("test-agent");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("supports 'orchestrator' alias command identically to 'orchestrator:run'", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-alias-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
            summary: "Alias command test passed.",
          };
        },
      };

      const result = await execute(
        [
          "orchestrator",
          "--repo",
          testDir,
          "--prompt",
          "Alias invocation test",
          "--run-id",
          "orch-alias-01",
        ],
        { executor: mockExecutor },
      );

      expect(result.base_run_id).toBe("orch-alias-01");
      expect(result.final_status).toBe("converged_success");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("ingests prompt from --prompt-file", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-file-"));
    try {
      const promptFilePath = join(testDir, "task-spec.md");
      writeFileSync(
        promptFilePath,
        "# Task Specification\n\nBuild full end-to-end telemetry system.",
        "utf-8",
      );

      let receivedPrompt = "";
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          receivedPrompt = input.prompt;
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
          };
        },
      };

      const result = await orchestratorRunCommand(
        { repo: testDir, "prompt-file": promptFilePath, "run-id": "orch-file-test" },
        { executor: mockExecutor },
      );

      expect(receivedPrompt).toContain("Build full end-to-end telemetry system.");
      expect(result.final_status).toBe("converged_success");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("ingests prompt from stdin (context.stdin)", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-stdin-"));
    try {
      const stdinData = new TextEncoder().encode("Prompt passed strictly through stdin pipe");
      let receivedPrompt = "";

      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          receivedPrompt = input.prompt;
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
          };
        },
      };

      const result = await execute(
        ["orchestrator:run", "--repo", testDir, "--prompt-stdin", "--run-id", "orch-stdin-test"],
        { stdin: stdinData, executor: mockExecutor },
      );

      expect(receivedPrompt).toBe("Prompt passed strictly through stdin pipe");
      expect(result.final_status).toBe("converged_success");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("leaves the loop summary unattributed when --actor is omitted", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-no-actor-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
          };
        },
      };

      await execute(
        [
          "orchestrator:run",
          "--repo",
          testDir,
          "--prompt",
          "Run with no attribution",
          "--run-id",
          "orch-no-actor",
        ],
        { executor: mockExecutor },
      );

      const summaryFile = join(testDir, ".capsules", "orch-no-actor-loop-summary.json");
      const fileData = JSON.parse(readFileSync(summaryFile, "utf-8"));
      expect(Object.hasOwn(fileData, "actor")).toBe(false);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("honors custom --capsules-dir and --run alias", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-capsules-"));
    const customCapsules = join(testDir, "custom-capsule-store");
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
          };
        },
      };

      const result = await orchestratorRunCommand(
        {
          repo: testDir,
          prompt: "Custom capsules dir test",
          run: "orch-run-alias",
          "capsules-dir": customCapsules,
        },
        { executor: mockExecutor },
      );

      expect(result.base_run_id).toBe("orch-run-alias");
      expect(result.capsules_dir).toBe(customCapsules);
      expect(existsSync(join(customCapsules, "orch-run-alias-loop-summary.json"))).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("auto-generates baseRunId when --run-id / --run is not provided", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-auto-id-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "completed",
            criticDecision: "approve",
            tasks: [],
            findings: [],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
          };
        },
      };

      const result = await orchestratorRunCommand(
        { repo: testDir, prompt: "Auto ID test" },
        { executor: mockExecutor },
      );

      expect(typeof result.base_run_id).toBe("string");
      expect((result.base_run_id as string).startsWith("orchestrator-")).toBe(true);
      expect(result.final_status).toBe("converged_success");
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("identifies stdin prompt flags", () => {
    expect(shouldReadPromptStdin(["orchestrator:run", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["orchestrator", "--prompt-stdin"])).toBeTrue();
    expect(shouldReadPromptStdin(["orchestrator:run", "--prompt", "Hello"])).toBeFalse();
  });
});

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orchestratorRunCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/orchestrator-ops.ts";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../../orchestrating-long-tasks/scripts/src/orchestrator/types.ts";

describe("CLI Command: orchestrator:run Stress & Edge Cases", () => {
  it("handles multi-round defect synthesis loop (R1 pushback -> R2 approval)", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-multi-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          if (input.round === 1) {
            return {
              runId: input.runId,
              round: 1,
              status: "rejected",
              criticDecision: "request_changes",
              tasks: [{ id: "task-01", status: "changes_requested", writeScope: ["src/"] }],
              findings: [
                {
                  id: "defect-01",
                  requirement_id: "req-01",
                  severity: "critical",
                  observation: "Null pointer exception in worker.ts",
                  evidence: [],
                  remediation: "Add null check",
                  revalidation: "bun test tests/worker.test.ts",
                  status: "open",
                },
              ],
              gateResults: [],
              summary: "Null check required in worker.ts",
            };
          }
          return {
            runId: input.runId,
            round: 2,
            status: "completed",
            criticDecision: "approve",
            tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
            findings: [
              {
                id: "defect-01",
                requirement_id: "req-01",
                severity: "critical",
                observation: "Null pointer exception in worker.ts",
                evidence: [],
                remediation: "Add null check",
                revalidation: "bun test tests/worker.test.ts",
                status: "resolved",
              },
            ],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-01", status: "passed" }],
            summary: "Defect resolved cleanly in Round 2.",
          };
        },
      };

      const result = await orchestratorRunCommand(
        { repo: testDir, prompt: "Fix crash in worker", "run-id": "orch-multi-test", "max-rounds": "5" },
        { executor: mockExecutor },
      );

      expect(result.final_status).toBe("converged_success");
      expect(result.rounds_executed).toBe(2);
      expect(result.total_findings_synthesized).toBe(1);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("stops with max_rounds_reached when all rounds fail", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-max-"));
    try {
      const mockExecutor: RoundExecutor = {
        async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
          return {
            runId: input.runId,
            round: input.round,
            status: "rejected",
            criticDecision: "request_changes",
            tasks: [],
            findings: [
              {
                id: `defect-${input.round}`,
                requirement_id: "req-01",
                severity: "important",
                observation: `Issue in round ${input.round}`,
                evidence: [],
                remediation: "Remediate",
                revalidation: "bun test",
                status: "open",
              },
            ],
            gateResults: [],
            summary: `Round ${input.round} failure.`,
          };
        },
      };

      const result = await orchestratorRunCommand(
        { repo: testDir, prompt: "Failing task", "run-id": "orch-max-reached", "max-rounds": "3" },
        { executor: mockExecutor },
      );

      expect(result.final_status).toBe("max_rounds_reached");
      expect(result.rounds_executed).toBe(3);
      expect(result.max_rounds_configured).toBe(3);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("clamps --max-rounds bounds cleanly between 1 and 10", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "cli-orch-clamp-"));
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
            gateResults: [],
          };
        },
      };

      const resLarge = await orchestratorRunCommand(
        { repo: testDir, prompt: "Clamp upper", "run-id": "clamp-lg", "max-rounds": "25" },
        { executor: mockExecutor },
      );
      expect(resLarge.max_rounds_configured).toBe(10);

      const resSmall = await orchestratorRunCommand(
        { repo: testDir, prompt: "Clamp lower", "run-id": "clamp-sm", "max-rounds": "-5" },
        { executor: mockExecutor },
      );
      expect(resSmall.max_rounds_configured).toBe(1);

      const resDefault = await orchestratorRunCommand(
        { repo: testDir, prompt: "Clamp default", "run-id": "clamp-def" },
        { executor: mockExecutor },
      );
      expect(resDefault.max_rounds_configured).toBe(10);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Validation and Error Handling", () => {
    it("rejects unknown flags with HarnessError INVALID_ARGUMENT", async () => {
      expect(orchestratorRunCommand({ prompt: "Valid", "bad-flag": "bad" })).rejects.toThrow(HarnessError);
    });

    it("rejects non-integer --max-rounds with HarnessError INVALID_ARGUMENT", async () => {
      expect(orchestratorRunCommand({ prompt: "Valid", "max-rounds": "not-num" })).rejects.toThrow(HarnessError);
      expect(orchestratorRunCommand({ prompt: "Valid", "max-rounds": "3.14" })).rejects.toThrow(HarnessError);
    });

    it("rejects missing prompt source with HarnessError INVALID_ARGUMENT", async () => {
      expect(orchestratorRunCommand({ repo: "/tmp", "run-id": "missing-prompt" })).rejects.toThrow(HarnessError);
    });

    it("rejects blank prompt with HarnessError INVALID_ARGUMENT", async () => {
      expect(orchestratorRunCommand({ prompt: "   ", "run-id": "blank-prompt" })).rejects.toThrow(HarnessError);
    });

    it("rejects missing prompt-file with HarnessError INVALID_ARGUMENT", async () => {
      expect(
        orchestratorRunCommand({ "prompt-file": "/non/existent/path.md", "run-id": "missing-file" }),
      ).rejects.toThrow(HarnessError);
    });

    it("rejects non-existent repo path with HarnessError INVALID_ARGUMENT", async () => {
      expect(
        orchestratorRunCommand({ repo: "/non/existent/repo/dir/12345", prompt: "Valid", "run-id": "missing-repo" }),
      ).rejects.toThrow(HarnessError);
    });

    it("rejects empty or whitespace-only prompt file with HarnessError INVALID_ARGUMENT", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "cli-orch-empty-file-"));
      try {
        const emptyFilePath = join(testDir, "empty.md");
        writeFileSync(emptyFilePath, "   \n\t  \n", "utf-8");
        expect(
          orchestratorRunCommand({ repo: testDir, "prompt-file": emptyFilePath, "run-id": "empty-file-test" }),
        ).rejects.toThrow(HarnessError);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("rejects empty stdin or whitespace-only stdin with HarnessError INVALID_ARGUMENT", async () => {
      const testDir = mkdtempSync(join(tmpdir(), "cli-orch-empty-stdin-"));
      try {
        expect(
          execute(["orchestrator:run", "--repo", testDir, "--prompt-stdin", "--run-id", "empty-stdin"], {
            stdin: new Uint8Array(0),
          }),
        ).rejects.toThrow(HarnessError);

        expect(
          execute(["orchestrator:run", "--repo", testDir, "--prompt-stdin", "--run-id", "ws-stdin"], {
            stdin: new TextEncoder().encode("   \n\t  "),
          }),
        ).rejects.toThrow(HarnessError);
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("rejects trailing positional arguments for orchestrator:run", async () => {
      expect(
        execute(["orchestrator:run", "--prompt", "Valid", "--", "trailing", "args"]),
      ).rejects.toThrow(HarnessError);
    });
  });
});

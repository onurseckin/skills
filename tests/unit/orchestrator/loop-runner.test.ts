import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { AutonomousLoopRunner } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import type {
  CapsuleChainManifest,
  DefectSynthesis,
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  RoundTelemetry,
  WatchdogEvent,
} from "../../../olt/scripts/src/orchestrator/types.ts";

describe("AutonomousLoopRunner Unit Tests", () => {
  it("converges in Round 1 when implementation is clean, gates pass, and Critic approves", async () => {
    const testDir = scratchRoot(import.meta.path, "round-1-converge");
    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "completed",
          criticDecision: "approve",
          tasks: [
            { id: "task-01", status: "done", writeScope: ["src/"] },
            { id: "task-02", status: "done", writeScope: ["tests/"] },
          ],
          findings: [],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
          summary: "All requirements met and verified.",
        };
      },
    };

    const startRounds: number[] = [];
    const completedTelemetries: RoundTelemetry[] = [];

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-r1-converge",
      repoPath: testDir,
      initialPrompt: "Implement feature X",
      executor: mockExecutor,
      onRoundStart: (round) => startRounds.push(round),
      onRoundComplete: (tel) => completedTelemetries.push(tel),
    }).run();

    expect(summary.totalRoundsExecuted).toBe(1);
    expect(summary.finalStatus).toBe("converged_success");
    expect(summary.gateStatus).toBe("passed");
    expect(summary.finalCriticDecision).toBe("approve");
    expect(summary.rounds.length).toBe(1);
    expect(startRounds).toEqual([1]);
    expect(completedTelemetries.length).toBe(1);
    expect(summary.finalMarkdownSummary).toContain("Autonomous Multi-Round Loop Summary");

    const persistedSummary = join(
      testDir,
      ".olt",
      "capsules",
      "run-test-r1-converge-loop-summary.json",
    );
    expect(existsSync(persistedSummary)).toBe(true);
  });

  it("does NOT converge if validation gates failed even if Critic approved and zero open findings", async () => {
    const testDir = scratchRoot(import.meta.path, "gate-fail-then-pass");
    let roundCounter = 0;
    const failingGateExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        roundCounter++;
        if (roundCounter === 1) {
          return {
            runId: input.runId,
            round: 1,
            status: "completed",
            criticDecision: "approve",
            tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
            findings: [],
            gateResults: [
              {
                gate_id: "gate-01",
                command_id: "cmd-failed",
                status: "failed",
              },
            ],
            summary: "Gate failed in R1.",
          };
        }
        return {
          runId: input.runId,
          round: 2,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
          findings: [],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-passed", status: "passed" }],
          summary: "Gate passed in R2.",
        };
      },
    };

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-gate-check",
      repoPath: testDir,
      initialPrompt: "Ensure gate verification is mandatory",
      maxRounds: 3,
      executor: failingGateExecutor,
    }).run();

    expect(summary.totalRoundsExecuted).toBe(2);
    expect(summary.finalStatus).toBe("converged_success");
  });

  it("executes multi-round loop with defect synthesis and capsule chaining (R1 fail -> R2 pass)", async () => {
    const testDir = scratchRoot(import.meta.path, "round-2-chain");
    let r2PromptReceived = "";
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
                id: "f-01",
                requirement_id: "req-01",
                severity: "critical",
                observation: "Memory leak in src/stream.ts",
                evidence: [],
                remediation: "Add stream cleanup handler in src/stream.ts",
                revalidation: "bun test tests/stream.test.ts",
                status: "open",
              },
            ],
            gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
            summary: "Critic detected memory leak.",
          };
        }
        r2PromptReceived = input.prompt;
        return {
          runId: input.runId,
          round: 2,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
          findings: [
            {
              id: "f-01",
              requirement_id: "req-01",
              severity: "critical",
              observation: "Memory leak in src/stream.ts",
              evidence: [],
              remediation: "Add stream cleanup handler",
              revalidation: "bun test tests/stream.test.ts",
              status: "resolved",
            },
          ],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-2", status: "passed" }],
          summary: "Memory leak resolved cleanly in Round 2.",
        };
      },
    };

    const syntheses: DefectSynthesis[] = [];
    const chainedManifests: CapsuleChainManifest[] = [];

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-r2-chain",
      repoPath: testDir,
      initialPrompt: "Build streaming data pipeline",
      executor: mockExecutor,
      onDefectSynthesis: (s) => syntheses.push(s),
      onCapsuleChained: (m) => chainedManifests.push(m),
    }).run();

    expect(summary.totalRoundsExecuted).toBe(2);
    expect(summary.finalStatus).toBe("converged_success");
    expect(syntheses.length).toBe(1);
    expect(syntheses[0]?.unresolvedFindings[0]?.id).toBe("f-01");
    expect(chainedManifests.length).toBe(1);
    expect(chainedManifests[0]?.sourceRunId).toBe("run-test-r2-chain-round-1");
    expect(r2PromptReceived).toContain("🔴 Critical Findings");
  });

  it("enforces max rounds limit and stops with max_rounds_reached", async () => {
    const testDir = scratchRoot(import.meta.path, "max-rounds");
    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "rejected",
          criticDecision: "request_changes",
          tasks: [{ id: "task-01", status: "changes_requested", writeScope: ["src/"] }],
          findings: [
            {
              id: `f-${input.round}`,
              requirement_id: "req-01",
              severity: "important",
              observation: `Issue in round ${input.round}`,
              evidence: [],
              remediation: "Remediate",
              revalidation: "bun test tests",
              status: "open",
            },
          ],
          gateResults: [],
          summary: `Round ${input.round} pushback.`,
        };
      },
    };

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-max-rounds",
      repoPath: testDir,
      initialPrompt: "Persistent failing task",
      maxRounds: 3,
      executor: mockExecutor,
    }).run();

    expect(summary.totalRoundsExecuted).toBe(3);
    expect(summary.maxRoundsConfigured).toBe(3);
    expect(summary.finalStatus).toBe("max_rounds_reached");
    expect(summary.rounds.length).toBe(3);
  });

  it("exposes maxRoundsConfigured and clamps requested maxRounds to MAX_ALLOWED_ROUNDS (10)", () => {
    const testDir = scratchRoot(import.meta.path, "clamp");
    const runnerLarge = new AutonomousLoopRunner({
      baseRunId: "run-clamp-large",
      repoPath: testDir,
      initialPrompt: "Prompt",
      maxRounds: 25,
    });
    expect(runnerLarge.maxRoundsConfigured).toBe(10);
    expect(runnerLarge.maxRounds).toBe(10);
    expect(runnerLarge.getRoundRunId(10)).toBe("run-clamp-large-round-10");

    const runnerDefault = new AutonomousLoopRunner({
      baseRunId: "run-clamp-def",
      repoPath: testDir,
      initialPrompt: "Prompt",
    });
    expect(runnerDefault.maxRoundsConfigured).toBe(10);

    const runnerSmall = new AutonomousLoopRunner({
      baseRunId: "run-clamp-small",
      repoPath: testDir,
      initialPrompt: "Prompt",
      maxRounds: 4,
    });
    expect(runnerSmall.maxRoundsConfigured).toBe(4);
  });

  it("handles unrecoverable failure and halts immediately", async () => {
    const testDir = scratchRoot(import.meta.path, "unrecoverable-fail");
    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "failed",
          criticDecision: "rejected",
          tasks: [],
          findings: [],
          gateResults: [],
          summary: "Fatal system crash.",
        };
      },
    };

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-fatal",
      repoPath: testDir,
      initialPrompt: "Crashing task",
      maxRounds: 5,
      executor: mockExecutor,
    }).run();

    expect(summary.totalRoundsExecuted).toBe(1);
    expect(summary.finalStatus).toBe("failed");
  });

  it("normalizes a .capsules/-prefixed baseRunId instead of double-joining it (FORENSICS §2.5)", async () => {
    // Every other CLI command documents `--run .capsules/<run-id>` as the value to pass. A caller
    // that reuses that same value as --run-id here previously produced a nested
    // `.capsules/.capsules/<run-id>` capsule and a `loopId` of `loop-.capsules/<run-id>` — see
    // docs/planning/coordinator-conformance/FORENSICS.md §2.5.
    const testDir = scratchRoot(import.meta.path, "capsules-prefixed-run-id");
    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        return {
          runId: input.runId,
          round: input.round,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
          findings: [],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
          summary: "Converged.",
        };
      },
    };

    const runner = new AutonomousLoopRunner({
      baseRunId: ".olt/capsules/2026-08-20-fine-grained-curriculum-orchestration",
      repoPath: testDir,
      initialPrompt: "Implement the curriculum",
      executor: mockExecutor,
    });

    expect(runner.baseRunId).toBe("2026-08-20-fine-grained-curriculum-orchestration");
    expect(runner.getCapsulePath("2026-08-20-fine-grained-curriculum-orchestration-round-1")).toBe(
      join(testDir, ".olt", "capsules", "2026-08-20-fine-grained-curriculum-orchestration-round-1"),
    );

    const summary = await runner.run();

    expect(summary.baseRunId).toBe("2026-08-20-fine-grained-curriculum-orchestration");
    expect(summary.loopId).toBe("loop-2026-08-20-fine-grained-curriculum-orchestration");
    expect(summary.loopId).not.toContain(".olt", "capsules");

    const persistedSummary = join(
      testDir,
      ".olt",
      "capsules",
      "2026-08-20-fine-grained-curriculum-orchestration-loop-summary.json",
    );
    expect(existsSync(persistedSummary)).toBe(true);
    expect(existsSync(join(testDir, ".olt", "capsules", ".olt", "capsules"))).toBe(false);
  });

  it("validates required options and throws HarnessError INVALID_ARGUMENT", () => {
    expect(
      () => new AutonomousLoopRunner({ baseRunId: "", repoPath: "/tmp", initialPrompt: "Prompt" }),
    ).toThrow(HarnessError);
    expect(
      () => new AutonomousLoopRunner({ baseRunId: "run-1", repoPath: "", initialPrompt: "Prompt" }),
    ).toThrow(HarnessError);
    expect(
      () => new AutonomousLoopRunner({ baseRunId: "run-1", repoPath: "/tmp", initialPrompt: "" }),
    ).toThrow(HarnessError);
  });

  it("integrates with watchdog and forwards stall events to onStall hook", async () => {
    const testDir = scratchRoot(import.meta.path, "watchdog-stall");
    const stallEvents: WatchdogEvent[] = [];
    const runner = new AutonomousLoopRunner({
      baseRunId: "run-stall-test",
      repoPath: testDir,
      initialPrompt: "Stall test",
      maxRounds: 1,
      onStall: (e) => stallEvents.push(e as WatchdogEvent),
    });

    const watchdog = runner.getWatchdog();
    watchdog.registerMonitor("test-mon", { agentId: "agent-x" });
    watchdog.triggerAutoWake("test-mon", "Simulated stall");

    expect(stallEvents.length).toBe(1);
    expect(stallEvents[0]?.type).toBe("auto_wake");
  });
});

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { AutonomousLoopRunner, executeOrchestratorTrack } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import type {
  CapsuleChainManifest,
  DefectSynthesis,
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  RoundTelemetry,
  WatchdogEvent,
} from "../../../olt/scripts/src/orchestrator/types.ts";

function getLoopTestDir(name: string): string {
  const dir = join(tmpdir(), `orchestrator-loop-runner-${Date.now()}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("AutonomousLoopRunner Unit Tests", () => {
  it("converges in Round 1 when implementation is clean, gates pass, and Critic approves", async () => {
    const testDir = getLoopTestDir("round-1-converge");
    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => ({
        runId: input.runId,
        round: input.round,
        status: "completed",
        criticDecision: "approve",
        tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
        findings: [],
        gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
        summary: "All requirements met and verified.",
      }),
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
    expect(startRounds).toEqual([1]);
    expect(completedTelemetries.length).toBe(1);
    expect(summary.finalMarkdownSummary).toContain("Autonomous Multi-Round Loop Summary");

    const persistedSummary = join(testDir, ".olt", "capsules", "run-test-r1-converge-loop-summary.json");
    expect(existsSync(persistedSummary)).toBe(true);
  });

  it("does NOT converge if validation gates failed even if Critic approved and zero open findings", async () => {
    const testDir = getLoopTestDir("gate-fail-then-pass");
    let roundCounter = 0;
    const failingGateExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => {
        roundCounter++;
        return {
          runId: input.runId,
          round: roundCounter,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
          findings: [],
          gateResults: [{ gate_id: "gate-01", command_id: "cmd-g", status: roundCounter === 1 ? "failed" : "passed" }],
          summary: roundCounter === 1 ? "Gate failed in R1." : "Gate passed in R2.",
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
    const testDir = getLoopTestDir("round-2-chain");
    let r2PromptReceived = "";
    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => {
        if (input.round === 1) {
          return {
            runId: input.runId,
            round: 1,
            status: "rejected",
            criticDecision: "request_changes",
            tasks: [{ id: "task-01", status: "changes_requested", writeScope: ["src/"] }],
            findings: [{ id: "f-01", requirement_id: "req-01", severity: "critical", observation: "Memory leak", evidence: [], remediation: "Add cleanup", revalidation: "bun test", status: "open" }],
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
          findings: [{ id: "f-01", requirement_id: "req-01", severity: "critical", observation: "Memory leak", evidence: [], remediation: "Add cleanup", revalidation: "bun test", status: "resolved" }],
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
    const testDir = getLoopTestDir("max-rounds");
    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => ({
        runId: input.runId,
        round: input.round,
        status: "rejected",
        criticDecision: "request_changes",
        tasks: [{ id: "task-01", status: "changes_requested", writeScope: ["src/"] }],
        findings: [{ id: `f-${input.round}`, requirement_id: "req-01", severity: "important", observation: "Issue", evidence: [], remediation: "Remediate", revalidation: "bun test", status: "open" }],
        gateResults: [],
        summary: `Round ${input.round} pushback.`,
      }),
    };

    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-max-rounds",
      repoPath: testDir,
      initialPrompt: "Persistent failing task",
      maxRounds: 3,
      executor: mockExecutor,
    }).run();

    expect(summary.totalRoundsExecuted).toBe(3);
    expect(summary.finalStatus).toBe("max_rounds_reached");
  });

  it("exposes maxRoundsConfigured and clamps requested maxRounds to MAX_ALLOWED_ROUNDS (10)", () => {
    const testDir = getLoopTestDir("clamp");
    const rLarge = new AutonomousLoopRunner({ baseRunId: "run-l", repoPath: testDir, initialPrompt: "P", maxRounds: 25 });
    expect(rLarge.maxRoundsConfigured).toBe(10);
    expect(rLarge.maxRounds).toBe(10);
    expect(rLarge.getRoundRunId(10)).toBe("run-l-round-10");

    const rDef = new AutonomousLoopRunner({ baseRunId: "run-d", repoPath: testDir, initialPrompt: "P" });
    expect(rDef.maxRoundsConfigured).toBe(10);

    const rSmall = new AutonomousLoopRunner({ baseRunId: "run-s", repoPath: testDir, initialPrompt: "P", maxRounds: 4 });
    expect(rSmall.maxRoundsConfigured).toBe(4);
  });

  it("handles unrecoverable failure and halts immediately", async () => {
    const testDir = getLoopTestDir("unrecoverable-fail");
    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => ({
        runId: input.runId,
        round: input.round,
        status: "failed",
        criticDecision: "rejected",
        tasks: [],
        findings: [],
        gateResults: [],
        summary: "Fatal crash.",
      }),
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

  it("normalizes a .capsules/-prefixed baseRunId without double-joining", async () => {
    const testDir = getLoopTestDir("capsules-prefixed-run-id");
    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => ({
        runId: input.runId,
        round: input.round,
        status: "completed",
        criticDecision: "approve",
        tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
        findings: [],
        gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
        summary: "Converged.",
      }),
    };

    const runner = new AutonomousLoopRunner({
      baseRunId: ".olt/capsules/2026-08-20-curriculum",
      repoPath: testDir,
      initialPrompt: "Implement curriculum",
      executor: mockExecutor,
    });

    expect(runner.baseRunId).toBe("2026-08-20-curriculum");
    const summary = await runner.run();
    expect(summary.baseRunId).toBe("2026-08-20-curriculum");
    expect(summary.loopId).toBe("loop-2026-08-20-curriculum");
  });

  it("executes orchestrator track through executeOrchestratorTrack helper", async () => {
    const testDir = getLoopTestDir("exec-track");
    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: testDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: testDir });
    Bun.spawnSync(["git", "config", "user.name", "test"], { cwd: testDir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: testDir });

    const mockExecutor: RoundExecutor = {
      executeRound: async (input: RoundExecutionInput): Promise<RoundExecutionResult> => ({
        runId: input.runId,
        round: input.round,
        status: "completed",
        criticDecision: "approve",
        tasks: [{ id: "task-01", status: "done", writeScope: ["src/"] }],
        findings: [],
        gateResults: [{ gate_id: "gate-01", command_id: "cmd-1", status: "passed" }],
        summary: "Track executed cleanly.",
      }),
    };

    const summary = await executeOrchestratorTrack({
      trackId: "track-test-helper",
      repoPath: testDir,
      initialPrompt: "Run orchestrator track",
      executor: mockExecutor,
      maxRounds: 2,
    });

    expect(summary.finalStatus).toBe("converged_success");
    expect(summary.totalRoundsExecuted).toBe(1);
  });

  it("validates required options and throws HarnessError INVALID_ARGUMENT", () => {
    expect(() => new AutonomousLoopRunner({ baseRunId: "", repoPath: "/tmp", initialPrompt: "Prompt" })).toThrow(HarnessError);
    expect(() => new AutonomousLoopRunner({ baseRunId: "run-1", repoPath: "", initialPrompt: "Prompt" })).toThrow(HarnessError);
    expect(() => new AutonomousLoopRunner({ baseRunId: "run-1", repoPath: "/tmp", initialPrompt: "" })).toThrow(HarnessError);
  });

  it("integrates with watchdog and forwards stall events to onStall hook", async () => {
    const testDir = getLoopTestDir("watchdog-stall");
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

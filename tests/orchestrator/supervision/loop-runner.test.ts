import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  AutonomousLoopRunner,
  executeOrchestratorTrack,
} from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import type {
  CapsuleChainManifest,
  DefectSynthesis,
  FindingDetail,
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
  WatchdogEvent,
} from "../../../olt/scripts/src/orchestrator/types.ts";

function testDir(name: string): string {
  const dir = join(tmpdir(), `loop-runner-${Date.now()}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const finding = (
  id: string,
  status: "open" | "resolved" = "open",
  severity: "critical" | "important" = "critical",
): FindingDetail => ({
  id,
  requirement_id: "req-01",
  severity,
  observation: "Memory leak",
  evidence: [],
  remediation: "Add cleanup",
  revalidation: "bun test",
  status,
});

const makeResult = (
  runId: string,
  round: number,
  status: "completed" | "rejected" | "failed",
  critic: "approve" | "request_changes" | "rejected",
  findings: FindingDetail[] = [],
  gatePassed = true,
  summary = "",
): RoundExecutionResult => ({
  runId,
  round,
  status,
  criticDecision: critic,
  tasks: [
    {
      id: "t1",
      status: status === "rejected" ? "changes_requested" : "done",
      writeScope: ["src/"],
    },
  ],
  findings,
  gateResults: [{ gate_id: "g1", command_id: "c1", status: gatePassed ? "passed" : "failed" }],
  summary,
});

const exec = (fn: (inp: RoundExecutionInput) => RoundExecutionResult): RoundExecutor => ({
  executeRound: async (inp) => fn(inp),
});

describe("AutonomousLoopRunner Unit Tests", () => {
  it("converges in Round 1 when implementation is clean, gates pass, and Critic approves", async () => {
    const dir = testDir("r1-converge");
    const rounds: number[] = [];
    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-test-r1",
      repoPath: dir,
      initialPrompt: "Implement feature X",
      executor: exec((i) =>
        makeResult(i.runId, i.round, "completed", "approve", [], true, "Verified."),
      ),
      onRoundStart: (r) => rounds.push(r),
    }).run();

    expect(summary.totalRoundsExecuted).toBe(1);
    expect(summary.finalStatus).toBe("converged_success");
    expect(summary.gateStatus).toBe("passed");
    expect(summary.finalCriticDecision).toBe("approve");
    expect(rounds).toEqual([1]);
    expect(existsSync(join(dir, ".olt", "capsules", "run-test-r1-loop-summary.json"))).toBe(true);
  });

  it("does NOT converge if validation gates failed even if Critic approved", async () => {
    const dir = testDir("gate-fail");
    let count = 0;
    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-gate",
      repoPath: dir,
      initialPrompt: "Gate check",
      maxRounds: 3,
      executor: exec((i) => makeResult(i.runId, ++count, "completed", "approve", [], count > 1)),
    }).run();
    expect(summary.totalRoundsExecuted).toBe(2);
    expect(summary.finalStatus).toBe("converged_success");
  });

  it("executes multi-round loop with defect synthesis and capsule chaining", async () => {
    const dir = testDir("chain");
    let r2Prompt = "";
    const syntheses: DefectSynthesis[] = [];
    const manifests: CapsuleChainManifest[] = [];
    const summary = await new AutonomousLoopRunner({
      baseRunId: "run-chain",
      repoPath: dir,
      initialPrompt: "Build pipeline",
      executor: exec((i) => {
        if (i.round === 1)
          return makeResult(i.runId, 1, "rejected", "request_changes", [finding("f-01", "open")]);
        r2Prompt = i.prompt;
        return makeResult(i.runId, 2, "completed", "approve", [finding("f-01", "resolved")]);
      }),
      onDefectSynthesis: (s) => syntheses.push(s),
      onCapsuleChained: (m) => manifests.push(m),
    }).run();

    expect(summary.totalRoundsExecuted).toBe(2);
    expect(summary.finalStatus).toBe("converged_success");
    expect(syntheses[0]?.unresolvedFindings[0]?.id).toBe("f-01");
    expect(manifests[0]?.sourceRunId).toBe("run-chain-round-1");
    expect(r2Prompt).toContain("🔴 Critical Findings");
  });

  it("enforces max rounds limit and handles unrecoverable failure", async () => {
    const dir = testDir("max-rounds");
    const summary1 = await new AutonomousLoopRunner({
      baseRunId: "run-max",
      repoPath: dir,
      initialPrompt: "Fail task",
      maxRounds: 3,
      executor: exec((i) =>
        makeResult(i.runId, i.round, "rejected", "request_changes", [
          finding(`f-${i.round}`, "open", "important"),
        ]),
      ),
    }).run();
    expect(summary1.totalRoundsExecuted).toBe(3);
    expect(summary1.finalStatus).toBe("max_rounds_reached");

    const summary2 = await new AutonomousLoopRunner({
      baseRunId: "run-fatal",
      repoPath: dir,
      initialPrompt: "Crash",
      maxRounds: 5,
      executor: exec((i) => makeResult(i.runId, i.round, "failed", "rejected")),
    }).run();
    expect(summary2.totalRoundsExecuted).toBe(1);
    expect(summary2.finalStatus).toBe("failed");
  });

  it("clamps maxRounds and normalizes .capsules/-prefixed baseRunId", async () => {
    const dir = testDir("clamp-prefix");
    expect(
      new AutonomousLoopRunner({
        baseRunId: "run-l",
        repoPath: dir,
        initialPrompt: "P",
        maxRounds: 25,
      }).maxRoundsConfigured,
    ).toBe(10);
    expect(
      new AutonomousLoopRunner({ baseRunId: "run-d", repoPath: dir, initialPrompt: "P" })
        .maxRoundsConfigured,
    ).toBe(10);
    expect(
      new AutonomousLoopRunner({
        baseRunId: "run-s",
        repoPath: dir,
        initialPrompt: "P",
        maxRounds: 4,
      }).maxRoundsConfigured,
    ).toBe(4);

    const rPrefix = new AutonomousLoopRunner({
      baseRunId: ".olt/capsules/2026-08-20-curriculum",
      repoPath: dir,
      initialPrompt: "Implement",
      executor: exec((i) => makeResult(i.runId, i.round, "completed", "approve")),
    });
    expect(rPrefix.baseRunId).toBe("2026-08-20-curriculum");
    expect((await rPrefix.run()).loopId).toBe("loop-2026-08-20-curriculum");
  });

  it("executes orchestrator track, validates options, and forwards watchdog stall events", async () => {
    const dir = testDir("track-opts-stall");
    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: dir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: dir });
    Bun.spawnSync(["git", "config", "user.name", "test"], { cwd: dir });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], { cwd: dir });

    const trackSummary = await executeOrchestratorTrack({
      trackId: "track-test",
      repoPath: dir,
      initialPrompt: "Run track",
      maxRounds: 2,
      executor: exec((i) =>
        makeResult(i.runId, i.round, "completed", "approve", [], true, "Track done."),
      ),
    });
    expect(trackSummary.finalStatus).toBe("converged_success");
    expect(trackSummary.totalRoundsExecuted).toBe(1);

    expect(
      () => new AutonomousLoopRunner({ baseRunId: "", repoPath: "/tmp", initialPrompt: "P" }),
    ).toThrow(HarnessError);
    expect(
      () => new AutonomousLoopRunner({ baseRunId: "r1", repoPath: "", initialPrompt: "P" }),
    ).toThrow(HarnessError);
    expect(
      () => new AutonomousLoopRunner({ baseRunId: "r1", repoPath: "/tmp", initialPrompt: "" }),
    ).toThrow(HarnessError);

    const stallEvents: WatchdogEvent[] = [];
    const runner = new AutonomousLoopRunner({
      baseRunId: "run-stall",
      repoPath: dir,
      initialPrompt: "Stall",
      maxRounds: 1,
      onStall: (e) => stallEvents.push(e as WatchdogEvent),
    });
    const watchdog = runner.getWatchdog();
    watchdog.registerMonitor("test-mon", { agentId: "agent-x" });
    watchdog.triggerAutoWake("test-mon", "Simulated stall");
    expect(stallEvents[0]?.type).toBe("auto_wake");
  });
});

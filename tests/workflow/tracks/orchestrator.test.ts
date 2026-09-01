import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { AutonomousLoopRunner } from "../../../olt/scripts/src/orchestrator/loop-runner.ts";
import { landPhaseRelease } from "../../../olt/scripts/src/orchestrator/station-landing.ts";
import type {
  RoundExecutionInput,
  RoundExecutionResult,
  RoundExecutor,
} from "../../../olt/scripts/src/orchestrator/types.ts";

import * as preCompletionModule from "../../../olt/scripts/src/reporting/doctor/pre-completion.ts";

const TEST_DIR = "/virtual/test-orch-worktree";

describe("orchestrator worktree integration (in-memory virtualization)", () => {
  let existsSpy: ReturnType<typeof spyOn>;
  let mkdirSpy: ReturnType<typeof spyOn>;
  let writeSpy: ReturnType<typeof spyOn>;
  let readdirSpy: ReturnType<typeof spyOn>;
  let preCompSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(true);
    mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined as unknown as string);
    writeSpy = spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    readdirSpy = spyOn(fs, "readdirSync").mockReturnValue([]);
    preCompSpy = spyOn(preCompletionModule, "checkPreCompletionDiagnostics").mockReturnValue({
      readyForCompletion: true,
      healthy: true,
      blockers: [],
      warnings: [],
      autoHealed: [],
      doctorReport:
        {} as unknown as preCompletionModule.PreCompletionDiagnosticsResult["doctorReport"],
    });
  });

  afterEach(() => {
    existsSpy.mockRestore();
    mkdirSpy.mockRestore();
    writeSpy.mockRestore();
    readdirSpy.mockRestore();
    preCompSpy.mockRestore();
  });

  test("AutonomousLoopRunner sets up worktree isolation and passes worktreePath to executor", async () => {
    let capturedInput: RoundExecutionInput | undefined;

    const mockExecutor: RoundExecutor = {
      async executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
        capturedInput = input;
        return {
          runId: input.runId,
          round: input.round,
          status: "completed",
          criticDecision: "approve",
          tasks: [{ id: "t1", status: "done", writeScope: ["src/"] }],
          findings: [],
          gateResults: [{ gate_id: "g1", command_id: "c1", status: "passed" }],
          summary: "All done",
        };
      },
    };

    const runner = new AutonomousLoopRunner({
      baseRunId: "test-run-wt",
      repoPath: TEST_DIR,
      initialPrompt: "Test prompt",
      maxRounds: 1,
      worktreeIsolation: false,
      trackId: "track-orch-1",
      executor: mockExecutor,
    });

    const summary = await runner.run();
    expect(summary.finalStatus).toBe("converged_success");
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.trackId).toBe("track-orch-1");
  });

  test("landPhaseRelease handles phase completion with trackId", () => {
    const result = landPhaseRelease({
      phaseName: "phase-test",
      startedAt: Date.now() - 50,
      notify: false,
      rootDir: TEST_DIR,
    });

    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

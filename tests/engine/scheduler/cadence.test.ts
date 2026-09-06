import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  ANTIGRAVITY_SCHEDULE_TOOL,
  DEFAULT_SUPERVISORY_CRON,
  STAGNATION_IDLE_THRESHOLD_SECONDS,
  buildFloorLoopCommand,
  evaluateStagnationWatchdog,
  executeFloorLoop,
  executeFloorLoopStep,
  formatStagnationAutoWakePrompt,
  handleTurnStartCadence,
  isSupervisoryCadenceRole,
  registerHostCronSchedule,
  type FloorLoopStepResult,
  type TurnStartContext,
} from "../../../olt/scripts/src/engine/scheduler/cadence.ts";

describe("Supervisory Cadence & Auto-Resuming Watchdog (DEFECT-CADENCE-SLEEP)", () => {
  describe("Floor Loop Driver with || true error isolation", () => {
    it("builds a floor loop command with explicit || true error isolation", () => {
      const cmd = buildFloorLoopCommand("bun harness.ts mind:pulse", { intervalSeconds: 300 });
      expect(cmd).toContain("|| true");
      expect(cmd).toContain("while true; do");
      expect(cmd).toContain("sleep 300; done");
      expect(cmd).toBe("while true; do (bun harness.ts mind:pulse) || true; sleep 300; done");
    });

    it("includes log redirect with || true error isolation when logPath is specified", () => {
      const cmd = buildFloorLoopCommand("bun harness.ts orch:tick", {
        intervalSeconds: 60,
        logPath: "/tmp/orch.log",
      });
      expect(cmd).toBe(
        "while true; do (bun harness.ts orch:tick) >> /tmp/orch.log 2>&1 || true; sleep 60; done",
      );
    });

    it("rejects empty commands with INVALID_ARGUMENT HarnessError", () => {
      expect(() => buildFloorLoopCommand("")).toThrow(HarnessError);
      expect(() => buildFloorLoopCommand("   ")).toThrow(HarnessError);
      try {
        buildFloorLoopCommand("");
      } catch (err) {
        expect(err instanceof HarnessError).toBe(true);
        expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
      }
    });

    it("rejects non-positive intervalSeconds with INVALID_ARGUMENT HarnessError", () => {
      expect(() => buildFloorLoopCommand("echo 1", { intervalSeconds: 0 })).toThrow(HarnessError);
      expect(() => buildFloorLoopCommand("echo 1", { intervalSeconds: -10 })).toThrow(HarnessError);
    });

    it("isolates errors during executeFloorLoopStep without throwing (|| true semantic)", async () => {
      const failingStep = async (): Promise<string> => {
        throw new Error("Simulated transient RPC crash");
      };

      const result: FloorLoopStepResult<string> = await executeFloorLoopStep(failingStep, 1);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Simulated transient RPC crash");
      expect(result.value).toBeUndefined();
      expect(result.iteration).toBe(1);
    });

    it("returns successful value during executeFloorLoopStep on clean execution", async () => {
      const successStep = async (): Promise<string> => "tick_success";
      const result = await executeFloorLoopStep(successStep, 2);
      expect(result.success).toBe(true);
      expect(result.value).toBe("tick_success");
      expect(result.error).toBeUndefined();
      expect(result.iteration).toBe(2);
    });

    it("executes multi-iteration floor loop continuing past isolated failures", async () => {
      const errorsRecorded: string[] = [];
      const executionLog: number[] = [];

      const result = await executeFloorLoop(
        async (iteration: number) => {
          executionLog.push(iteration);
          if (iteration === 2) {
            throw new Error(`Iteration ${iteration} crashed`);
          }
          return `iter-${iteration}`;
        },
        {
          maxIterations: 3,
          onError: (err) => errorsRecorded.push(err),
        },
      );

      expect(executionLog).toEqual([1, 2, 3]);
      expect(result.totalIterations).toBe(3);
      expect(result.successfulIterations).toBe(2);
      expect(result.failedIterations).toBe(1);
      expect(result.aborted).toBe(false);
      expect(errorsRecorded).toEqual(["Iteration 2 crashed"]);
      expect(result.steps[1].success).toBe(false);
      expect(result.steps[1].error).toBe("Iteration 2 crashed");
    });

    it("aborts execution when AbortSignal is signaled", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await executeFloorLoop(async () => "should not run", {
        maxIterations: 5,
        signal: controller.signal,
      });

      expect(result.aborted).toBe(true);
      expect(result.totalIterations).toBe(0);
    });

    it("correctly identifies supervisory cadence roles", () => {
      expect(isSupervisoryCadenceRole("mind")).toBe(true);
      expect(isSupervisoryCadenceRole("orchestrator")).toBe(true);
      expect(isSupervisoryCadenceRole("coordinator")).toBe(true);
      expect(isSupervisoryCadenceRole("mind_supervisor")).toBe(true);
      expect(isSupervisoryCadenceRole("autonomic_watchdog")).toBe(true);

      expect(isSupervisoryCadenceRole("implementer")).toBe(false);
      expect(isSupervisoryCadenceRole("validator")).toBe(false);
      expect(isSupervisoryCadenceRole("repairer")).toBe(false);
    });
  });

  describe("Host Cron Schedule Registration on Antigravity Host", () => {
    it("registers */5 * * * * cron schedule on Antigravity host upon turn start", () => {
      const context: TurnStartContext = {
        role: "coordinator",
        agentId: "coord-1",
        host: "antigravity",
      };

      const registration = registerHostCronSchedule(context);
      expect(registration.registered).toBe(true);
      expect(registration.tool).toBe(ANTIGRAVITY_SCHEDULE_TOOL);
      expect(registration.tool).toBe("schedule");
      expect(registration.parameters.CronExpression).toBe(DEFAULT_SUPERVISORY_CRON);
      expect(registration.parameters.CronExpression).toBe("*/5 * * * *");
      expect(registration.parameters.Prompt).toContain("coordinator");
      expect(registration.dispatched).toBe(false);
    });

    it("invokes host dispatcher tool call when provided on Antigravity host", () => {
      const dispatchedCalls: { tool: string; params: Record<string, unknown> }[] = [];
      const dispatcher = (tool: string, params: Record<string, unknown>): void => {
        dispatchedCalls.push({ tool, params });
      };

      const context: TurnStartContext = {
        role: "orchestrator",
        agentId: "orch-1",
        host: "antigravity",
        prompt: "Run 5-minute supervisory pulse check",
      };

      const registration = registerHostCronSchedule(context, dispatcher);
      expect(registration.registered).toBe(true);
      expect(registration.dispatched).toBe(true);
      expect(dispatchedCalls).toHaveLength(1);
      expect(dispatchedCalls[0].tool).toBe("schedule");
      expect(dispatchedCalls[0].params.CronExpression).toBe("*/5 * * * *");
      expect(dispatchedCalls[0].params.Prompt).toBe("Run 5-minute supervisory pulse check");
    });

    it("does not mark registered or dispatch schedule on non-antigravity host", () => {
      const dispatchedCalls: { tool: string; params: Record<string, unknown> }[] = [];
      const dispatcher = (tool: string, params: Record<string, unknown>): void => {
        dispatchedCalls.push({ tool, params });
      };

      const context: TurnStartContext = {
        role: "mind",
        agentId: "mind-1",
        host: "claude_code",
      };

      const registration = registerHostCronSchedule(context, dispatcher);
      expect(registration.registered).toBe(false);
      expect(registration.dispatched).toBe(false);
      expect(dispatchedCalls).toHaveLength(0);
    });
  });

  describe("Stagnation Watchdog Auto-Wake Injections (> 120s Idle)", () => {
    it("does not trigger auto-wake when idle duration is within 120s boundary", () => {
      const evalZero = evaluateStagnationWatchdog({
        idleDurationSeconds: 0,
        role: "coordinator",
      });
      expect(evalZero.isStagnant).toBe(false);
      expect(evalZero.autoWakeInjected).toBe(false);
      expect(evalZero.injectionPayload).toBeUndefined();

      const evalBorder = evaluateStagnationWatchdog({
        idleDurationSeconds: STAGNATION_IDLE_THRESHOLD_SECONDS, // exactly 120s
        role: "coordinator",
      });
      expect(evalBorder.isStagnant).toBe(false);
      expect(evalBorder.autoWakeInjected).toBe(false);
      expect(evalBorder.injectionPayload).toBeUndefined();
    });

    it("enforces auto-wake injection when idle duration strictly exceeds 120s", () => {
      const evalStagnant = evaluateStagnationWatchdog({
        idleDurationSeconds: 121,
        role: "orchestrator",
        agentId: "orch-leader",
        now: "2026-09-06T00:00:00.000Z",
      });

      expect(evalStagnant.isStagnant).toBe(true);
      expect(evalStagnant.autoWakeInjected).toBe(true);
      expect(evalStagnant.thresholdSeconds).toBe(120);
      expect(evalStagnant.idleDurationSeconds).toBe(121);

      const payload = evalStagnant.injectionPayload;
      expect(payload).toBeDefined();
      expect(payload?.type).toBe("auto_wake_injection");
      expect(payload?.alert).toBe(
        "CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>120s Idle)",
      );
      expect(payload?.role).toBe("orchestrator");
      expect(payload?.agentId).toBe("orch-leader");
      expect(payload?.promptDirective).toContain("121s exceeds the 120s inactivity ceiling");
    });

    it("formats a high-visibility stagnation auto-wake prompt", () => {
      const evaluation = evaluateStagnationWatchdog({
        idleDurationSeconds: 180,
        role: "mind",
        agentId: "mind-0",
        now: "2026-09-06T00:15:00.000Z",
      });

      expect(evaluation.injectionPayload).toBeDefined();
      if (!evaluation.injectionPayload) return;

      const formatted = formatStagnationAutoWakePrompt(evaluation.injectionPayload);
      expect(formatted).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");
      expect(formatted).toContain(
        "CRITICAL SUPERVISORY ALERT: Live Stagnation Detected (>120s Idle)",
      );
      expect(formatted).toContain("Idle Duration: 180s (Threshold: 120s)");
      expect(formatted).toContain("Execute supervisory cadence recovery immediately.");
    });

    it("coordinates turn start with cron registration and stagnation injection", () => {
      const resultStagnant = handleTurnStartCadence({
        role: "coordinator",
        agentId: "coord-interlocks",
        host: "antigravity",
        idleDurationSeconds: 150,
      });

      expect(resultStagnant.cronRegistration.registered).toBe(true);
      expect(resultStagnant.cronRegistration.parameters.CronExpression).toBe("*/5 * * * *");
      expect(resultStagnant.stagnationEvaluation.isStagnant).toBe(true);
      expect(resultStagnant.stagnationEvaluation.autoWakeInjected).toBe(true);
      expect(resultStagnant.autoWakeDirective).toContain("[LIVE_STAGNATION_WAKEUP_INJECTION]");

      const resultActive = handleTurnStartCadence({
        role: "coordinator",
        agentId: "coord-interlocks",
        host: "antigravity",
        idleDurationSeconds: 45,
      });

      expect(resultActive.cronRegistration.registered).toBe(true);
      expect(resultActive.stagnationEvaluation.isStagnant).toBe(false);
      expect(resultActive.stagnationEvaluation.autoWakeInjected).toBe(false);
      expect(resultActive.autoWakeDirective).toBeUndefined();
    });
  });
});

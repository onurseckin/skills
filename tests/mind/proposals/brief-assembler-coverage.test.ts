import { describe, expect, it } from "bun:test";
import { assembleWakeBriefContext } from "../../../olt/scripts/src/mind/proposals/brief/assembler.ts";
import type {
  WakeBriefContextInput,
  LiveRunSummary,
} from "../../../olt/scripts/src/mind/proposals/brief/types.ts";

describe("Mind Wake Brief Assembler Suite", () => {
  const dummyLiveRun = (overrides: Partial<LiveRunSummary> = {}): LiveRunSummary => ({
    runId: "run-child-1",
    runRoot: "/capsules/run-child-1",
    phase: "executing",
    tasksCount: 4,
    leasedCount: 1,
    escalatedCount: 0,
    greenGatesCount: 2,
    totalGatesCount: 2,
    hasStaleLease: false,
    readyTasksCount: 0,
    openFindingsCount: 0,
    failingGatesCount: 0,
    ...overrides,
  });

  const makeInput = (overrides: Partial<WakeBriefContextInput> = {}): WakeBriefContextInput => ({
    mindRunRoot: "/capsules/mind-root",
    actualRunRoot: "/capsules/mind-root",
    repoRoot: "/repo",
    capsulesDir: "/capsules",
    nowMs: 1756700000000,
    state: {},
    manifest: {},
    mindState: { actor: "mind-actor" },
    charterStatus: "ok",
    charterSha: "sha-charter-123",
    runtimeStatus: "ok",
    runtimeVersion: "1.0.0",
    integrityStatus: "ok",
    unrepairableCount: 0,
    pulsesToday: 10,
    pulsesPerDay: 50,
    wallClockTodayMs: 120000,
    wallClockPerDayMs: 7200000,
    maxAgentsInFlight: 4,
    eventSequence: 100,
    maxEventCount: 2000,
    gapMs: 3000,
    armedIntervalMs: 60000,
    driverLatenessMs: 50,
    driverLateWarning: false,
    liveRuns: [],
    agentsInFlight: 0,
    escalationsCount: 0,
    openFindingsCount: 0,
    staleLeasesCount: 0,
    healthObservations: [],
    healthAgeMs: 500,
    consecutiveCrashes: 0,
    isHalted: false,
    haltReason: undefined,
    options: {},
    budgetDeferred: false,
    isQuietHours: false,
    pulseRecord: { counter: 5 },
    lastPulse: null,
    openPulse: null,
    ...overrides,
  });

  describe("Mode Determination", () => {
    it("sets mode to halted with explicit or fallback halt reason", () => {
      const explicit = assembleWakeBriefContext(
        makeInput({ isHalted: true, haltReason: "Critical error" }),
      );
      expect(explicit.mode).toBe("halted");
      expect(explicit.facts.haltReason).toBe("Critical error");
      expect(explicit.nextArgv).toEqual([
        "bun",
        "harness.ts",
        "mind:escalate",
        "--run",
        "/capsules/mind-root",
        "--actor",
        "mind-actor",
        "--reason",
        "Critical error",
      ]);
      expect(explicit.thenArgv).toEqual([
        "bun",
        "harness.ts",
        "mind:halt",
        "--run",
        "/capsules/mind-root",
        "--actor",
        "mind-actor",
        "--reason",
        "Critical error",
      ]);

      const fallback = assembleWakeBriefContext(
        makeInput({ isHalted: true, haltReason: undefined }),
      );
      expect(fallback.nextArgv[8]).toBe("mind halted");
    });

    it("sets mode to paused when budgetDeferred, isQuietHours, or lastPulse outcome is paused", () => {
      expect(assembleWakeBriefContext(makeInput({ budgetDeferred: true })).mode).toBe("paused");
      expect(assembleWakeBriefContext(makeInput({ isQuietHours: true })).mode).toBe("paused");
      expect(assembleWakeBriefContext(makeInput({ lastPulse: { outcome: "paused" } })).mode).toBe(
        "paused",
      );
    });

    it("sets mode to work when liveRuns exist with active workloads", () => {
      const runWithReady = dummyLiveRun({ readyTasksCount: 2 });
      expect(assembleWakeBriefContext(makeInput({ liveRuns: [runWithReady] })).mode).toBe("work");
      expect(
        assembleWakeBriefContext(makeInput({ liveRuns: [dummyLiveRun()], staleLeasesCount: 1 }))
          .mode,
      ).toBe("work");
      expect(
        assembleWakeBriefContext(makeInput({ liveRuns: [dummyLiveRun()], openFindingsCount: 1 }))
          .mode,
      ).toBe("work");
      expect(
        assembleWakeBriefContext(makeInput({ liveRuns: [dummyLiveRun()], agentsInFlight: 1 })).mode,
      ).toBe("work");
    });

    it("sets mode to idle when liveRuns are empty or without active signals", () => {
      expect(assembleWakeBriefContext(makeInput({ liveRuns: [] })).mode).toBe("idle");
      expect(assembleWakeBriefContext(makeInput({ liveRuns: [dummyLiveRun()] })).mode).toBe("idle");
    });
  });

  describe("Actor & Counter Resolution", () => {
    it("resolves actor priority across options, openPulse, mindState, and fallback", () => {
      expect(
        assembleWakeBriefContext(
          makeInput({ options: { actor: "opt-actor" }, openPulse: { actor: "pulse-actor" } }),
        ).actor,
      ).toBe("opt-actor");
      expect(
        assembleWakeBriefContext(makeInput({ options: {}, openPulse: { actor: "pulse-actor" } }))
          .actor,
      ).toBe("pulse-actor");
      expect(
        assembleWakeBriefContext(
          makeInput({ options: {}, openPulse: null, mindState: { actor: "state-actor" } }),
        ).actor,
      ).toBe("state-actor");
      expect(
        assembleWakeBriefContext(makeInput({ options: {}, openPulse: null, mindState: {} })).actor,
      ).toBe("mind-1");
    });

    it("resolves pulseCounter from record or falls back to 1", () => {
      expect(
        assembleWakeBriefContext(makeInput({ pulseRecord: { counter: 42 } })).pulseCounter,
      ).toBe(42);
      expect(assembleWakeBriefContext(makeInput({ pulseRecord: {} })).pulseCounter).toBe(1);
    });
  });

  describe("Lane & Argv Command Generation", () => {
    it("generates rotation command when eventSequence exceeds 90% of maxEventCount", () => {
      const res = assembleWakeBriefContext(makeInput({ eventSequence: 1900, maxEventCount: 2000 }));
      expect(res.nextArgv).toEqual([
        "bun",
        "harness.ts",
        "mind:rotate",
        "--run",
        "/capsules/mind-root",
        "--next-run",
        "/capsules/mind-root-next",
        "--actor",
        "mind-actor",
      ]);
      expect(res.thenArgv).toEqual([
        "bun",
        "harness.ts",
        "mind:wake",
        "--run",
        "/capsules/mind-root",
      ]);
    });

    it("generates defer, rescue, repair, and advance lane commands correctly", () => {
      const rDefer = assembleWakeBriefContext(
        makeInput({ budgetDeferred: true, options: { host: "antigravity", driver: "cron" } }),
      );
      expect(rDefer.lane === "defer" && rDefer.nextArgv[6] === "antigravity").toBe(true);

      const staleRun = dummyLiveRun({ hasStaleLease: true, runRoot: "/capsules/stale-run-99" });
      const rRescue = assembleWakeBriefContext(
        makeInput({ staleLeasesCount: 1, liveRuns: [staleRun] }),
      );
      expect(rRescue.lane === "rescue" && rRescue.nextArgv[4] === "/capsules/stale-run-99").toBe(
        true,
      );
      expect(
        assembleWakeBriefContext(makeInput({ staleLeasesCount: 1, liveRuns: [] })).nextArgv[4],
      ).toBe("/capsules/mind-root");

      const repairRun = dummyLiveRun({ openFindingsCount: 1, runRoot: "/capsules/repair-run-77" });
      const rRepair = assembleWakeBriefContext(
        makeInput({ openFindingsCount: 1, liveRuns: [repairRun] }),
      );
      expect(rRepair.lane === "repair" && rRepair.nextArgv[4] === "/capsules/repair-run-77").toBe(
        true,
      );

      const rAdvance = assembleWakeBriefContext(
        makeInput({
          liveRuns: [dummyLiveRun({ readyTasksCount: 1 })],
          options: { host: "claude" },
        }),
      );
      expect(rAdvance.lane === "advance" && rAdvance.nextArgv[6] === "claude-code").toBe(true);

      const ctx = assembleWakeBriefContext(
        makeInput({ unrepairableCount: undefined as unknown as number }),
      );
      expect(
        ctx.facts.integrityIssuesCount === 0 && ctx.actualRunRoot === "/capsules/mind-root",
      ).toBe(true);
    });
  });
});

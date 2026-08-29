import { resolveHostProviderLoose } from "../../../core/config/host-canon.ts";
import type {
  WakeBriefFullContext,
  WakeBriefContextInput,
  MindMode,
  MindBriefFacts,
} from "./types.ts";
import { deriveLane } from "./types.ts";

export function assembleWakeBriefContext(ctx: WakeBriefContextInput): WakeBriefFullContext {
  const {
    mindRunRoot,
    actualRunRoot,
    repoRoot,
    capsulesDir,
    nowMs,
    state,
    manifest,
    mindState,
    charterStatus,
    charterSha,
    runtimeStatus,
    runtimeVersion,
    integrityStatus,
    unrepairableCount,
    pulsesToday,
    pulsesPerDay,
    wallClockTodayMs,
    wallClockPerDayMs,
    maxAgentsInFlight,
    eventSequence,
    maxEventCount,
    gapMs,
    armedIntervalMs,
    driverLatenessMs,
    driverLateWarning,
    liveRuns,
    agentsInFlight,
    escalationsCount,
    openFindingsCount,
    staleLeasesCount,
    healthObservations,
    healthAgeMs,
    consecutiveCrashes,
    isHalted,
    haltReason,
    options,
    budgetDeferred,
    isQuietHours,
    pulseRecord,
    lastPulse,
    openPulse,
  } = ctx;

  // 10. Determine MODE
  let mode: MindMode = "idle";
  if (isHalted) {
    mode = "halted";
  } else if (budgetDeferred || isQuietHours || lastPulse?.outcome === "paused") {
    mode = "paused";
  } else if (
    liveRuns.length > 0 &&
    (staleLeasesCount > 0 ||
      openFindingsCount > 0 ||
      agentsInFlight > 0 ||
      liveRuns.some((r) => r.readyTasksCount > 0))
  ) {
    mode = "work";
  } else {
    mode = "idle";
  }

  // 11. Determine LANE
  const lane = deriveLane({
    mode,
    budgetDeferred,
    isQuietHours,
    staleLeasesCount,
    openFindingsCount,
    liveRuns,
  });

  // 12. Actor & Counter
  const pulseCounter = typeof pulseRecord.counter === "number" ? pulseRecord.counter : 1;
  const actor =
    options.actor ??
    (typeof openPulse?.actor === "string" ? openPulse.actor : undefined) ??
    (typeof mindState.actor === "string" ? mindState.actor : "mind-1");

  const host = resolveHostProviderLoose(options.host);
  const driver = options.driver ?? "manual";

  // 13. Determine NEXT and THEN argv
  let nextArgv: string[] = [];
  let thenArgv: string[] = [];

  if (mode === "halted") {
    const reason = haltReason ?? "mind halted";
    nextArgv = [
      "bun",
      "harness.ts",
      "mind:escalate",
      "--run",
      actualRunRoot,
      "--actor",
      actor,
      "--reason",
      reason,
    ];
    thenArgv = [
      "bun",
      "harness.ts",
      "mind:halt",
      "--run",
      actualRunRoot,
      "--actor",
      actor,
      "--reason",
      reason,
    ];
  } else if (eventSequence >= 0.9 * maxEventCount) {
    nextArgv = [
      "bun",
      "harness.ts",
      "mind:rotate",
      "--run",
      actualRunRoot,
      "--next-run",
      `${actualRunRoot}-next`,
      "--actor",
      actor,
    ];
    thenArgv = ["bun", "harness.ts", "mind:wake", "--run", actualRunRoot];
  } else if (lane === "defer") {
    nextArgv = [
      "bun",
      "harness.ts",
      "mind:pulse",
      "--run",
      actualRunRoot,
      "--actor",
      actor,
      "--host",
      host,
      "--driver",
      driver,
    ];
    thenArgv = ["bun", "harness.ts", "mind:pulse", "--run", actualRunRoot, "--arm", "15m"];
  } else if (lane === "rescue") {
    const rescueTarget =
      liveRuns.find((r) => r.hasStaleLease)?.runRoot ?? liveRuns[0]?.runRoot ?? actualRunRoot;
    nextArgv = [
      "bun",
      "harness.ts",
      "orchestrator:supervise",
      "--run",
      rescueTarget,
      "--actor",
      actor,
    ];
    thenArgv = ["bun", "harness.ts", "mind:pulse", "--run", actualRunRoot, "--arm", "15m"];
  } else if (lane === "repair") {
    const repairTarget =
      liveRuns.find((r) => r.openFindingsCount > 0 || r.failingGatesCount > 0)?.runRoot ??
      actualRunRoot;
    nextArgv = [
      "bun",
      "harness.ts",
      "orchestrator:supervise",
      "--run",
      repairTarget,
      "--actor",
      actor,
    ];
    thenArgv = ["bun", "harness.ts", "mind:pulse", "--run", actualRunRoot, "--arm", "15m"];
  } else {
    // quiesce or advance
    nextArgv = [
      "bun",
      "harness.ts",
      "mind:pulse",
      "--run",
      actualRunRoot,
      "--actor",
      actor,
      "--host",
      host,
      "--driver",
      driver,
    ];
    thenArgv = ["bun", "harness.ts", "mind:pulse", "--run", actualRunRoot, "--arm", "15m"];
  }

  const facts: MindBriefFacts = {
    mode,
    charterStatus,
    charterSha,
    runtimeStatus,
    runtimeVersion,
    integrityStatus,
    integrityIssuesCount: unrepairableCount ?? 0,
    pulsesToday,
    pulsesPerDay,
    wallClockTodayMs,
    wallClockPerDayMs,
    agentsInFlight,
    maxAgentsInFlight,
    eventSequence,
    maxEventCount,
    gapMs,
    armedIntervalMs,
    driverLatenessMs,
    driverLateWarning,
    liveRuns,
    escalationsCount,
    openFindingsCount,
    staleLeasesCount,
    unrepairableIssuesCount: unrepairableCount,
    healthObservations,
    healthAgeMs,
    lane,
    nextArgv,
    thenArgv,
    pulseCounter,
    actor,
    haltReason,
    budgetDeferred,
    isQuietHours,
    consecutiveCrashes,
  };

  return {
    facts,
    actualRunRoot,
    nowMs,
    actor,
    pulseCounter,
    mode,
    lane,
    isHalted,
    haltReason,
    integrityStatus,
    charterStatus,
    charterSha,
    runtimeStatus,
    runtimeVersion,
    driverLateWarning,
    driverLatenessMs,
    armedIntervalMs,
    gapMs,
    nextArgv,
    thenArgv,
    liveRuns,
    pulsesToday,
    pulsesPerDay,
    wallClockTodayMs,
    wallClockPerDayMs,
    agentsInFlight,
    maxAgentsInFlight,
    eventSequence,
    maxEventCount,
    escalationsCount,
    unrepairableCount,
    openFindingsCount,
    staleLeasesCount,
    healthObservations,
    healthAgeMs,
  };
}

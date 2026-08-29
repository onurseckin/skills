import { join } from "node:path";
import type { BuildWakeBriefOptions, WakeBriefResult } from "./types.ts";
import { formatDuration, formatNumber, formatShortSha } from "./types.ts";
import {
  renderCharterLine,
  renderRuntimeLine,
  renderIntegrityLine,
  renderGapLine,
  renderHealthLine,
} from "./formatters.ts";
import { enforceLineLimit } from "../../lifecycle/cadence/index.ts";
import { computeFullWakeBrief } from "./builder.ts";

export async function buildWakeBrief(
  mindRunRoot: string,
  options: BuildWakeBriefOptions = {},
): Promise<WakeBriefResult> {
  const full = await computeFullWakeBrief(mindRunRoot, options);
  const {
    facts,
    escalationsCount,
    unrepairableCount,
    openFindingsCount,
    staleLeasesCount,
    healthObservations,
    healthAgeMs,
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
  } = full;

  const isoTimestamp = new Date(nowMs).toISOString();
  const lines: string[] = [
    `### Pulse ${formatNumber(pulseCounter)}  ·  ${actor}  ·  ${isoTimestamp}`,
    `MODE      ${mode.padEnd(16)}(work | idle | paused | halted)`,
    `CHARTER   ${renderCharterLine(charterStatus, charterSha)}`,
    `RUNTIME   ${renderRuntimeLine(runtimeStatus, runtimeVersion)}`,
    `INTEGRITY ${renderIntegrityLine(integrityStatus)}`,
    `BUDGET    ${pulsesToday}/${pulsesPerDay} pulses today · ${formatDuration(wallClockTodayMs)}/${formatDuration(wallClockPerDayMs)} wall · ${agentsInFlight}/${maxAgentsInFlight} agents`,
    `GAP       ${renderGapLine(gapMs, armedIntervalMs, driverLatenessMs)}`,
    "",
    `RUNS      ${liveRuns.length} live`,
  ];

  for (const run of liveRuns.slice(0, 5)) {
    lines.push(
      `  ${run.runId.padEnd(25)}${run.phase.padEnd(12)}${run.tasksCount} tasks  ${run.leasedCount} leased  ${run.escalatedCount} escalated  gates ${run.greenGatesCount}/${run.totalGatesCount} green`,
    );
  }

  lines.push("");
  lines.push(
    `ATTENTION ${escalationsCount} escalation${escalationsCount === 1 ? "" : "s"} · ${openFindingsCount} open finding${openFindingsCount === 1 ? "" : "s"} · ${staleLeasesCount} stale lease${staleLeasesCount === 1 ? "" : "s"} · ${unrepairableCount} unrepairable`,
  );
  lines.push(`HEALTH    ${renderHealthLine(healthObservations, healthAgeMs)}`);
  lines.push("");
  lines.push(`LANE      ${lane.padEnd(16)}(rescue | repair | advance | discover | quiesce)`);
  lines.push(`NEXT      ${nextArgv.join(" ")}`);
  lines.push(`THEN      ${thenArgv.join(" ")}`);

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    mode,
    lane,
    charterStatus,
    runtimeStatus,
    integrityStatus,
    next: nextArgv,
    then: thenArgv,
    pulseCounter,
    actor,
    facts,
  };
}

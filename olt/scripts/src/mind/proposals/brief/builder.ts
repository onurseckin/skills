import { assembleWakeBriefContext } from "./assembler.ts";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { installedRuntimeFreshness } from "../../../installer/runtime-freshness.ts";
import { validateSkillSource } from "../../../installer/source-validation.ts";
import { loadRun, verifyIntegrity, transact } from "../../../engine/store/index.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../../core/shared/paths.ts";
import { resolveHostProviderLoose } from "../../../core/config/host-canon.ts";
import { resolveCharterPath, loadCharter } from "../../lifecycle/charter/index.ts";
import { reconcileLastPulse } from "../../lifecycle/pulse/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  MindMode,
  MindLane,
  CharterStatus,
  RuntimeStatus,
  IntegrityStatus,
  MindBriefFacts,
  HealthObservationSummary,
  BuildWakeBriefOptions,
  LiveRunSummary,
} from "./types.ts";
import {
  formatDuration,
  formatNumber,
  formatShortSha,
  deriveLane,
  parseNowMs,
  extractLiveRuns,
  type WakeBriefFullContext,
} from "./types.ts";
import {
  renderCharterLine,
  renderRuntimeLine,
  renderIntegrityLine,
  renderGapLine,
  renderHealthLine,
} from "./formatters.ts";

export async function computeFullWakeBrief(
  mindRunRoot: string,
  options: BuildWakeBriefOptions = {},
): Promise<WakeBriefFullContext> {
  const nowMs = parseNowMs(options.now);
  const loaded = loadRun(mindRunRoot, false);
  const state = loaded.state;
  const manifest = loaded.manifest;
  const actualRunRoot = loaded?.runRoot ?? mindRunRoot;
  const repoRoot = findRepoRoot(actualRunRoot);
  const capsulesDir = dirname(actualRunRoot);

  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const charterRecord = (mindState.charter ?? {}) as Record<string, unknown>;
  const budgetRecord = (state.budget ?? {}) as Record<string, unknown>;
  const pulseRecord = (state.pulse ?? {}) as Record<string, unknown>;
  const lastPulse = (pulseRecord.last ?? null) as Record<string, unknown> | null;
  const openPulse = (pulseRecord.open ?? null) as Record<string, unknown> | null;

  // 1. Check Charter
  const charterSourceRel =
    typeof charterRecord.source_path === "string"
      ? charterRecord.source_path
      : "olt/agents/mind.yaml";
  const charterRepoRoots = Array.isArray(charterRecord.repo_roots)
    ? charterRecord.repo_roots.filter((r): r is string => typeof r === "string")
    : undefined;
  const charterFullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);
  let charterStatus: CharterStatus = "missing";
  let charterSha: string | null = null;

  if (existsSync(charterFullPath) && lstatSync(charterFullPath).isFile()) {
    try {
      const fileBytes = readFileSync(charterFullPath);
      charterSha = createHash("sha256").update(fileBytes).digest("hex");
      const pinnedDigest =
        (typeof charterRecord.pinned_sha256 === "string" && charterRecord.pinned_sha256) ||
        manifest.prompt_sha256;
      if (charterSha === pinnedDigest) {
        charterStatus = "ok";
      } else {
        charterStatus = "DRIFTED";
      }
    } catch {
      charterStatus = "missing";
    }
  }

  // 2. Check Runtime Freshness
  let runtimeStatus: RuntimeStatus = "unknown";
  let runtimeVersion: string | null = null;
  try {
    const scriptsRoot = resolve(import.meta.dirname, "..");
    const validated = await validateSkillSource(resolve(scriptsRoot, ".."));
    const freshness = await installedRuntimeFreshness(validated, options.home);
    if (freshness.drifted) {
      runtimeStatus = "drifted";
      runtimeVersion = freshness.referenceRuntimeVersion;
    } else {
      runtimeStatus = "ok";
      runtimeVersion = freshness.referenceRuntimeVersion;
    }
  } catch {
    runtimeStatus = "unknown";
  }

  // 3. Check Integrity
  const integrityIssues = verifyIntegrity(mindRunRoot);
  let integrityStatus: IntegrityStatus = "ok";
  let unrepairableCount = 0;
  if (integrityIssues.length > 0) {
    const unrepairable = integrityIssues.filter(
      (issue) => issue.subcode !== "READ_RACE" && issue.code !== "STATE_PROJECTION",
    );
    if (unrepairable.length === 0) {
      integrityStatus = "repairable";
    } else {
      integrityStatus = "FAILED";
      unrepairableCount = unrepairable.length;
    }
  }

  // 4. Check Budget
  const pulsesToday = typeof budgetRecord.pulses_today === "number" ? budgetRecord.pulses_today : 0;
  const pulsesPerDay =
    typeof budgetRecord.pulses_per_day === "number" ? budgetRecord.pulses_per_day : 96;
  const wallClockTodayMs =
    typeof budgetRecord.wall_clock_ms_today === "number" ? budgetRecord.wall_clock_ms_today : 0;
  const wallClockPerDayMs =
    typeof budgetRecord.wall_clock_ms_per_day === "number"
      ? budgetRecord.wall_clock_ms_per_day
      : 21_600_000;
  const maxAgentsInFlight =
    typeof budgetRecord.max_agents_in_flight === "number" ? budgetRecord.max_agents_in_flight : 8;
  const eventSequence = state.event_sequence ?? 0;
  const maxEventCount = 100_000;

  const budgetDeferred = pulsesToday >= pulsesPerDay || wallClockTodayMs >= wallClockPerDayMs;
  const isQuietHours = false;

  // 5. Check GAP and reconcile last_pulse.json
  try {
    reconcileLastPulse(actualRunRoot, state);
  } catch {
    // Non-fatal
  }

  let gapMs: number | null = null;
  let armedIntervalMs: number | null = null;
  let driverLatenessMs: number | null = null;
  let driverLateWarning = false;

  if (lastPulse && typeof lastPulse.closed_at === "string") {
    const closedAt = Date.parse(lastPulse.closed_at);
    if (Number.isFinite(closedAt)) {
      gapMs = Math.max(0, nowMs - closedAt);
      armedIntervalMs =
        typeof lastPulse.armed_interval_ms === "number" ? lastPulse.armed_interval_ms : 900_000;
      driverLatenessMs = gapMs - armedIntervalMs;
      driverLateWarning = gapMs > 3 * armedIntervalMs;
    }
  }

  // 6. Live Runs
  const liveRuns = extractLiveRuns(capsulesDir, actualRunRoot, nowMs);
  const agentsInFlight = liveRuns.reduce((sum, r) => sum + r.leasedCount, 0);

  // 7. Attention
  const stateEscalations = Array.isArray(state.escalations)
    ? (state.escalations as readonly Record<string, unknown>[]).filter(
        (e) => e.resolved_at === null,
      )
    : [];
  const escalationsCount =
    stateEscalations.length + liveRuns.reduce((sum, r) => sum + r.escalatedCount, 0);
  const openFindingsCount = liveRuns.reduce((sum, r) => sum + r.openFindingsCount, 0);
  const staleLeasesCount = liveRuns.filter((r) => r.hasStaleLease).length;

  // 8. Health Observations
  const rawObservations = Array.isArray(state.observations)
    ? (state.observations as readonly Record<string, unknown>[])
    : [];
  const healthObsMap = new Map<string, { count: number; observed_at?: string | undefined }>();
  let latestObservedAtMs: number | null = null;

  for (const obs of rawObservations) {
    const source = typeof obs.source === "string" ? obs.source : "unknown";
    const count = typeof obs.count === "number" ? obs.count : 0;
    const observedAt = typeof obs.observed_at === "string" ? obs.observed_at : undefined;
    healthObsMap.set(source, { count, observed_at: observedAt });
    if (observedAt) {
      const parsed = Date.parse(observedAt);
      if (Number.isFinite(parsed) && (latestObservedAtMs === null || parsed > latestObservedAtMs)) {
        latestObservedAtMs = parsed;
      }
    }
  }

  const healthObservations: HealthObservationSummary[] = [
    { source: "intent-drift", count: healthObsMap.get("intent-drift")?.count ?? 0 },
    { source: "unused-code", count: healthObsMap.get("unused-code")?.count ?? 0 },
    { source: "unenforced", count: healthObsMap.get("unenforced")?.count ?? 0 },
  ].filter((h) => healthObsMap.has(h.source));

  const healthAgeMs = latestObservedAtMs !== null ? Math.max(0, nowMs - latestObservedAtMs) : null;

  // 9. Consecutive Crashes and Halted Status
  const consecutiveCrashes =
    lastPulse && lastPulse.outcome === "crashed"
      ? typeof lastPulse.consecutive_crashes === "number"
        ? lastPulse.consecutive_crashes
        : 1
      : 0;
  const isHalted =
    charterStatus === "DRIFTED" ||
    charterStatus === "missing" ||
    integrityStatus === "FAILED" ||
    consecutiveCrashes >= 3 ||
    mindState.halted === true;

  const haltReason =
    charterStatus === "DRIFTED"
      ? "charter drifted from pinned digest"
      : charterStatus === "missing"
        ? "charter file missing"
        : integrityStatus === "FAILED"
          ? "mind capsule integrity failed"
          : consecutiveCrashes >= 3
            ? "consecutive pulse crashes threshold exceeded"
            : typeof mindState.halt_reason === "string"
              ? mindState.halt_reason
              : undefined;
  return assembleWakeBriefContext({
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
    budgetDeferred: pulsesToday >= pulsesPerDay || wallClockTodayMs >= wallClockPerDayMs,
    isQuietHours: false,
    pulseRecord,
    lastPulse,
    openPulse,
  });
}

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";
import { installedRuntimeFreshness } from "../installer/runtime-freshness.ts";
import { validateSkillSource } from "../installer/source-validation.ts";
import { loadRun, verifyIntegrity } from "../store/index.ts";
import { findRepoRoot } from "../shared/paths.ts";
import { resolveCharterPath } from "./charter.ts";
import { reconcileLastPulse } from "./last-pulse.ts";

export type MindMode = "work" | "idle" | "paused" | "halted";
export type MindLane = "rescue" | "repair" | "advance" | "discover" | "quiesce" | "defer";
export type CharterStatus = "ok" | "DRIFTED" | "missing";
export type RuntimeStatus = "ok" | "drifted" | "unknown";
export type IntegrityStatus = "ok" | "repairable" | "FAILED";

export interface LiveRunSummary {
  readonly runId: string;
  readonly runRoot: string;
  readonly phase: string;
  readonly tasksCount: number;
  readonly leasedCount: number;
  readonly escalatedCount: number;
  readonly greenGatesCount: number;
  readonly totalGatesCount: number;
  readonly hasStaleLease: boolean;
  readonly readyTasksCount: number;
  readonly openFindingsCount: number;
  readonly failingGatesCount: number;
}

export interface HealthObservationSummary {
  readonly source: string;
  readonly count: number;
}

export interface MindBriefFacts {
  readonly mode: MindMode;
  readonly charterStatus: CharterStatus;
  readonly charterSha: string | null;
  readonly runtimeStatus: RuntimeStatus;
  readonly runtimeVersion: string | null;
  readonly integrityStatus: IntegrityStatus;
  readonly integrityIssuesCount: number;
  readonly pulsesToday: number;
  readonly pulsesPerDay: number;
  readonly wallClockTodayMs: number;
  readonly wallClockPerDayMs: number;
  readonly agentsInFlight: number;
  readonly maxAgentsInFlight: number;
  readonly eventSequence: number;
  readonly maxEventCount: number;
  readonly gapMs: number | null;
  readonly armedIntervalMs: number | null;
  readonly driverLatenessMs: number | null;
  readonly driverLateWarning: boolean;
  readonly liveRuns: readonly LiveRunSummary[];
  readonly escalationsCount: number;
  readonly openFindingsCount: number;
  readonly staleLeasesCount: number;
  readonly unrepairableIssuesCount: number;
  readonly healthObservations: readonly HealthObservationSummary[];
  readonly healthAgeMs: number | null;
  readonly lane: MindLane;
  readonly nextArgv: readonly string[];
  readonly thenArgv: readonly string[];
  readonly pulseCounter: number;
  readonly actor: string;
  readonly haltReason?: string | undefined;
  readonly budgetDeferred: boolean;
  readonly isQuietHours: boolean;
  readonly consecutiveCrashes: number;
}

export interface BuildWakeBriefOptions {
  readonly now?: number | Date | string | undefined;
  readonly actor?: string | undefined;
  readonly home?: string | undefined;
  readonly host?: string | undefined;
  readonly driver?: string | undefined;
  readonly targetRun?: string | undefined;
}

export interface WakeBriefResult {
  readonly markdown: string;
  readonly mode: MindMode;
  readonly lane: MindLane;
  readonly charterStatus: CharterStatus;
  readonly runtimeStatus: RuntimeStatus;
  readonly integrityStatus: IntegrityStatus;
  readonly next: readonly string[];
  readonly then: readonly string[];
  readonly pulseCounter: number;
  readonly actor: string;
  readonly facts: MindBriefFacts;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) {
    const seconds = Math.round(ms / 1000);
    return `${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatShortSha(sha: string): string {
  if (sha.length <= 8) return sha;
  return `${sha.slice(0, 4)}…${sha.slice(-3)}`;
}

export function deriveLane(facts: {
  readonly mode: MindMode;
  readonly budgetDeferred: boolean;
  readonly isQuietHours: boolean;
  readonly staleLeasesCount: number;
  readonly openFindingsCount: number;
  readonly liveRuns: readonly LiveRunSummary[];
}): MindLane {
  if (facts.mode === "halted") {
    return "quiesce";
  }
  if (facts.budgetDeferred || facts.isQuietHours) {
    return "defer";
  }
  if (facts.staleLeasesCount > 0) {
    return "rescue";
  }
  const hasFailingGates = facts.liveRuns.some((r) => r.failingGatesCount > 0);
  const hasEscalations = facts.liveRuns.some((r) => r.escalatedCount > 0);
  if (facts.openFindingsCount > 0 || hasFailingGates || hasEscalations) {
    return "repair";
  }
  const hasReadyTasks = facts.liveRuns.some((r) => r.readyTasksCount > 0);
  if (hasReadyTasks) {
    return "advance";
  }
  return "quiesce";
}

function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function extractLiveRuns(
  capsulesDir: string,
  currentRunRoot: string,
  nowMs: number,
): LiveRunSummary[] {
  const currentBasename = basename(currentRunRoot);
  if (!existsSync(capsulesDir) || !lstatSync(capsulesDir).isDirectory()) {
    return [];
  }
  const entries = readdirSync(capsulesDir, { withFileTypes: true });
  const summaries: LiveRunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (
      entry.name === currentBasename ||
      entry.name.startsWith("mind-") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const runPath = join(capsulesDir, entry.name);
    try {
      const loaded = loadRun(runPath, false);
      const state = loaded.state;
      const completion = state.completion_result as { status?: string } | undefined;
      if (completion?.status === "complete") continue;

      const tasksRecord = (state.tasks ?? {}) as Record<string, Record<string, unknown>>;
      const tasks = Object.values(tasksRecord);
      const tasksCount = tasks.length;
      const leasedCount = tasks.filter((t) => t.lease !== undefined).length;
      const escalatedCount = tasks.filter((t) => t.status === "escalated").length;
      const readyTasksCount = tasks.filter(
        (t) => t.status === "ready" || t.status === "retry_ready",
      ).length;

      let hasStaleLease = false;
      for (const t of tasks) {
        if (t.lease && typeof t.lease === "object") {
          const expiresAt = (t.lease as Record<string, unknown>).expires_at;
          if (typeof expiresAt === "string" && Date.parse(expiresAt) < nowMs) {
            hasStaleLease = true;
          }
        }
      }

      let openFindingsCount = 0;
      for (const t of tasks) {
        if (Array.isArray(t.open_finding_ids)) {
          openFindingsCount += t.open_finding_ids.length;
        }
      }

      const gatesRecord = (state.gates ?? {}) as Record<string, Record<string, unknown>>;
      const gates = Object.values(gatesRecord);
      const greenGatesCount = gates.filter(
        (g) => g.status === "passed" || g.exit_code === 0,
      ).length;
      const failingGatesCount = gates.filter(
        (g) => g.status === "failed" || (typeof g.exit_code === "number" && g.exit_code !== 0),
      ).length;
      const totalGatesCount = gates.length;

      const phase = tasks.some((t) => t.status === "validating")
        ? "validating"
        : state.graph
          ? "executing"
          : "planning";

      summaries.push({
        runId: entry.name,
        runRoot: runPath,
        phase,
        tasksCount,
        leasedCount,
        escalatedCount,
        greenGatesCount,
        totalGatesCount,
        hasStaleLease,
        readyTasksCount,
        openFindingsCount,
        failingGatesCount,
      });
    } catch {
      // Ignore unreadable or non-run directories
    }
  }

  return summaries;
}

function renderCharterLine(status: CharterStatus, sha: string | null): string {
  if (status === "ok" && sha) {
    const formattedSha = formatShortSha(sha);
    return `ok  ${formattedSha.padEnd(8)} (ok | DRIFTED | missing)`;
  }
  if (status === "DRIFTED") {
    return "DRIFTED     (ok | DRIFTED | missing)";
  }
  return "missing     (ok | DRIFTED | missing)";
}

function renderRuntimeLine(status: RuntimeStatus, version: string | null): string {
  if (status === "ok" && version) {
    return `ok  ${version.padEnd(8)} (ok | drifted | unknown)`;
  }
  if (status === "drifted") {
    return "drifted     (ok | drifted | unknown)";
  }
  return "unknown     (ok | drifted | unknown)";
}

function renderIntegrityLine(status: IntegrityStatus): string {
  if (status === "ok") {
    return "ok          (ok | repairable | FAILED)";
  }
  if (status === "repairable") {
    return "repairable  (ok | repairable | FAILED)";
  }
  return "FAILED      (ok | repairable | FAILED)";
}

export function renderGapLine(
  gapMs: number | null,
  armedMs: number | null,
  driverLatenessMs: number | null,
): string {
  if (gapMs === null || armedMs === null || driverLatenessMs === null) {
    return "unknown";
  }
  const gapStr = formatDuration(gapMs);
  const armedStr = formatDuration(armedMs);
  const is3xLate = gapMs > 3 * armedMs;
  if (is3xLate) {
    return `${gapStr} (armed ${armedStr}; driver late by ${formatDuration(driverLatenessMs)} [WARNING: > 3x armed interval])`;
  }
  if (Math.abs(driverLatenessMs) < 60_000) {
    return `${gapStr} (armed ${armedStr}; driver on time)`;
  }
  if (driverLatenessMs > 0) {
    return `${gapStr} (armed ${armedStr}; driver late by ${formatDuration(driverLatenessMs)})`;
  }
  return `${gapStr} (armed ${armedStr}; driver early by ${formatDuration(-driverLatenessMs)})`;
}

function renderHealthLine(
  observations: readonly HealthObservationSummary[],
  ageMs: number | null,
): string {
  if (observations.length === 0) {
    return "unknown";
  }
  const parts = observations.map((obs) => `${obs.source} ${obs.count}`);
  const ageStr = ageMs !== null ? `(last run ${formatDuration(ageMs)} ago)` : "";
  return `${parts.join(" · ")}        ${ageStr}`.trimEnd();
}

export async function buildWakeBrief(
  mindRunRoot: string,
  options: BuildWakeBriefOptions = {},
): Promise<WakeBriefResult> {
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
      : "docs/mind/CHARTER.md";
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

  const host = options.host ?? "antigravity";
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
    integrityIssuesCount: integrityIssues.length,
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

  // Build markdown brief lines
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

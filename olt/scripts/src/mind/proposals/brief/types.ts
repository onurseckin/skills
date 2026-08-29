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

export interface WakeBriefFullContext {
  facts: MindBriefFacts;
  actualRunRoot: string;
  nowMs: number;
  actor: string;
  pulseCounter: number;
  mode: MindMode;
  lane: MindLane;
  isHalted: boolean;
  haltReason?: string | undefined;
  integrityStatus: IntegrityStatus;
  charterStatus: CharterStatus;
  charterSha: string | null;
  runtimeStatus: RuntimeStatus;
  runtimeVersion: string | null;
  driverLateWarning: boolean;
  driverLatenessMs: number | null;
  armedIntervalMs: number | null;
  gapMs: number | null;
  nextArgv: string[];
  thenArgv: string[];
  liveRuns: readonly LiveRunSummary[];
  pulsesToday: number;
  pulsesPerDay: number;
  wallClockTodayMs: number;
  wallClockPerDayMs: number;
  agentsInFlight: number;
  maxAgentsInFlight: number;
  eventSequence: number;
  maxEventCount: number;
  escalationsCount: number;
  unrepairableCount: number;
  openFindingsCount: number;
  staleLeasesCount: number;
  healthObservations: readonly HealthObservationSummary[];
  healthAgeMs: number | null;
}

export interface WakeBriefContextInput {
  mindRunRoot: string;
  actualRunRoot: string;
  repoRoot: string;
  capsulesDir: string;
  nowMs: number;
  state: Record<string, unknown>;
  manifest: Record<string, unknown>;
  mindState: Record<string, unknown>;
  charterStatus: CharterStatus;
  charterSha: string | null;
  runtimeStatus: RuntimeStatus;
  runtimeVersion: string | null;
  integrityStatus: IntegrityStatus;
  unrepairableCount: number;
  pulsesToday: number;
  pulsesPerDay: number;
  wallClockTodayMs: number;
  wallClockPerDayMs: number;
  maxAgentsInFlight: number;
  eventSequence: number;
  maxEventCount: number;
  gapMs: number | null;
  armedIntervalMs: number | null;
  driverLatenessMs: number | null;
  driverLateWarning: boolean;
  liveRuns: readonly LiveRunSummary[];
  agentsInFlight: number;
  escalationsCount: number;
  openFindingsCount: number;
  staleLeasesCount: number;
  healthObservations: readonly HealthObservationSummary[];
  healthAgeMs: number | null;
  consecutiveCrashes: number;
  isHalted: boolean;
  haltReason?: string | undefined;
  options: BuildWakeBriefOptions;
  budgetDeferred: boolean;
  isQuietHours: boolean;
  pulseRecord: Record<string, unknown>;
  lastPulse: Record<string, unknown> | null;
  openPulse: Record<string, unknown> | null;
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

export { parseNowMs, extractLiveRuns } from "./runs.ts";

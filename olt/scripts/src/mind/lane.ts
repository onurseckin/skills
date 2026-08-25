import { DEFAULT_CONSECUTIVE_CRASH_THRESHOLD } from "./pulse-reclaim.ts";

export type MindMode = "work" | "idle" | "paused" | "halted";
export type MindLane = "rescue" | "repair" | "advance" | "discover" | "quiesce" | "defer";
export type CharterStatus = "ok" | "DRIFTED" | "missing";
export type RuntimeStatus = "ok" | "drifted" | "unknown";
export type IntegrityStatus = "ok" | "repairable" | "FAILED";

export interface LiveRunSummary {
  readonly runId?: string;
  readonly runRoot?: string;
  readonly phase?: string;
  readonly tasksCount?: number;
  readonly leasedCount?: number;
  readonly escalatedCount?: number;
  readonly greenGatesCount?: number;
  readonly totalGatesCount?: number;
  readonly hasStaleLease?: boolean;
  readonly readyTasksCount?: number;
  readonly openFindingsCount?: number;
  readonly failingGatesCount?: number;
}

export interface HealthObservationSummary {
  readonly source: string;
  readonly count: number;
}

export interface LaneSelectorFacts {
  readonly mode?: MindMode;
  readonly budgetDeferred?: boolean;
  readonly isQuietHours?: boolean;
  readonly charterStatus?: CharterStatus;
  readonly runtimeStatus?: RuntimeStatus;
  readonly integrityStatus?: IntegrityStatus;
  readonly integrityIssuesCount?: number;
  readonly unrepairableIssuesCount?: number;
  readonly staleLeasesCount?: number;
  readonly deadAgentsCount?: number;
  readonly openFindingsCount?: number;
  readonly failingGatesCount?: number;
  readonly escalationsCount?: number;
  readonly readyTasksCount?: number;
  readonly dispatchableTasksCount?: number;
  readonly liveRuns?: readonly LiveRunSummary[];
  readonly candidatesCount?: number;
  readonly unadmittedCandidatesCount?: number;
  readonly admittedCandidatesCount?: number;
  readonly hasDiscoveryWork?: boolean;
  readonly consecutiveCrashes?: number;
  readonly pulsesToday?: number;
  readonly pulsesPerDay?: number;
  readonly wallClockTodayMs?: number;
  readonly wallClockPerDayMs?: number;
  readonly agentsInFlight?: number;
  readonly maxAgentsInFlight?: number;
  readonly eventSequence?: number;
  readonly maxEventCount?: number;
  readonly gapMs?: number | null;
  readonly armedIntervalMs?: number | null;
  readonly driverLatenessMs?: number | null;
  readonly healthObservations?: readonly HealthObservationSummary[];
  readonly healthAgeMs?: number | null;
}

export interface LaneSelectorOptions {
  readonly phase?: number;
  readonly allowAdvanceAndDiscover?: boolean;
}

export interface LaneDecision {
  readonly lane: MindLane;
  readonly theoreticalLane: MindLane;
  readonly reason: string;
  readonly phaseMasked: boolean;
}

/**
 * Pure function that computes the detailed lane decision according to
 * PLAN.md §4.2 priority order:
 * 1. RESCUE — stale leases, dead agents, repairable integrity issues
 * 2. REPAIR — open findings, failing gates, escalations
 * 3. ADVANCE — dispatchable/ready tasks in live runs (returns quiesce in Phase 2)
 * 4. DISCOVER — novel candidates/sources (reachable ONLY if 1-3 empty, returns quiesce in Phase 2)
 * 5. QUIESCE — nothing pending
 *
 * Preconditions (Halt & Defer):
 * - Halted state (drift, failed integrity, consecutive crashes) returns "quiesce"
 * - Budget exhaustion or quiet hours returns "defer"
 */
export function selectLane(facts: LaneSelectorFacts, options?: LaneSelectorOptions): LaneDecision {
  const currentPhase = options?.phase ?? 2;
  const allowAdvanceAndDiscover = options?.allowAdvanceAndDiscover ?? currentPhase >= 3;

  // Precondition 1: Halt conditions
  const isHalted =
    facts.mode === "halted" ||
    facts.charterStatus === "DRIFTED" ||
    facts.charterStatus === "missing" ||
    facts.integrityStatus === "FAILED" ||
    (facts.unrepairableIssuesCount !== undefined && facts.unrepairableIssuesCount > 0) ||
    (facts.consecutiveCrashes !== undefined &&
      facts.consecutiveCrashes >= DEFAULT_CONSECUTIVE_CRASH_THRESHOLD);

  if (isHalted) {
    return {
      lane: "quiesce",
      theoreticalLane: "quiesce",
      reason: "mind is halted or requires owner intervention",
      phaseMasked: false,
    };
  }

  // Precondition 2: Deferral conditions (budget limit, quiet hours, paused)
  const isBudgetExhausted =
    (facts.pulsesToday !== undefined &&
      facts.pulsesPerDay !== undefined &&
      facts.pulsesToday >= facts.pulsesPerDay) ||
    (facts.wallClockTodayMs !== undefined &&
      facts.wallClockPerDayMs !== undefined &&
      facts.wallClockTodayMs >= facts.wallClockPerDayMs);

  const isDeferred =
    Boolean(facts.budgetDeferred) ||
    Boolean(facts.isQuietHours) ||
    facts.mode === "paused" ||
    isBudgetExhausted;

  if (isDeferred) {
    return {
      lane: "defer",
      theoreticalLane: "defer",
      reason: "budget exhausted, quiet hours active, or paused",
      phaseMasked: false,
    };
  }

  // Priority 1: RESCUE
  const hasStaleLeases =
    (facts.staleLeasesCount !== undefined && facts.staleLeasesCount > 0) ||
    Boolean(facts.liveRuns?.some((r) => Boolean(r.hasStaleLease)));
  const hasDeadAgents = facts.deadAgentsCount !== undefined && facts.deadAgentsCount > 0;
  const hasRepairableIntegrity =
    facts.integrityStatus === "repairable" ||
    (facts.integrityIssuesCount !== undefined && facts.integrityIssuesCount > 0);

  if (hasStaleLeases || hasDeadAgents || hasRepairableIntegrity) {
    return {
      lane: "rescue",
      theoreticalLane: "rescue",
      reason: "stale leases, dead agents, or repairable integrity issues present",
      phaseMasked: false,
    };
  }

  // Priority 2: REPAIR
  const hasOpenFindings =
    (facts.openFindingsCount !== undefined && facts.openFindingsCount > 0) ||
    Boolean(facts.liveRuns?.some((r) => (r.openFindingsCount ?? 0) > 0));
  const hasFailingGates =
    (facts.failingGatesCount !== undefined && facts.failingGatesCount > 0) ||
    Boolean(facts.liveRuns?.some((r) => (r.failingGatesCount ?? 0) > 0));
  const hasEscalations =
    (facts.escalationsCount !== undefined && facts.escalationsCount > 0) ||
    Boolean(facts.liveRuns?.some((r) => (r.escalatedCount ?? 0) > 0));

  if (hasOpenFindings || hasFailingGates || hasEscalations) {
    return {
      lane: "repair",
      theoreticalLane: "repair",
      reason: "open findings, failing gates, or escalations present",
      phaseMasked: false,
    };
  }

  // Priority 3: ADVANCE
  const hasReadyTasks =
    (facts.readyTasksCount !== undefined && facts.readyTasksCount > 0) ||
    (facts.dispatchableTasksCount !== undefined && facts.dispatchableTasksCount > 0) ||
    Boolean(facts.liveRuns?.some((r) => (r.readyTasksCount ?? 0) > 0));

  if (hasReadyTasks) {
    if (allowAdvanceAndDiscover) {
      return {
        lane: "advance",
        theoreticalLane: "advance",
        reason: "dispatchable tasks available in live run",
        phaseMasked: false,
      };
    }
    return {
      lane: "quiesce",
      theoreticalLane: "advance",
      reason: "advance lane not implemented in Phase 2; returning quiesce",
      phaseMasked: true,
    };
  }

  // Priority 4: DISCOVER (provably reachable only when 1-3 are empty)
  const hasDiscoveryCandidates =
    (facts.candidatesCount !== undefined && facts.candidatesCount > 0) ||
    (facts.unadmittedCandidatesCount !== undefined && facts.unadmittedCandidatesCount > 0) ||
    (facts.admittedCandidatesCount !== undefined && facts.admittedCandidatesCount > 0) ||
    Boolean(facts.hasDiscoveryWork);

  if (hasDiscoveryCandidates) {
    if (allowAdvanceAndDiscover) {
      return {
        lane: "discover",
        theoreticalLane: "discover",
        reason: "discovery candidates available to explore",
        phaseMasked: false,
      };
    }
    return {
      lane: "quiesce",
      theoreticalLane: "discover",
      reason: "discover lane not implemented in Phase 2; returning quiesce",
      phaseMasked: true,
    };
  }

  // Priority 5: QUIESCE
  return {
    lane: "quiesce",
    theoreticalLane: "quiesce",
    reason: "no pending actions across any lane",
    phaseMasked: false,
  };
}

/**
 * Pure lane selector function mapping brief facts to MindLane.
 * In Phase 2, advance and discover return "quiesce".
 */
export function deriveLane(facts: LaneSelectorFacts, options?: LaneSelectorOptions): MindLane {
  return selectLane(facts, options).lane;
}

/**
 * Pure function returning the theoretical lane without Phase 2 quiesce masking.
 */
export function deriveTheoreticalLane(facts: LaneSelectorFacts): MindLane {
  return selectLane(facts, { allowAdvanceAndDiscover: true, phase: 3 }).theoreticalLane;
}

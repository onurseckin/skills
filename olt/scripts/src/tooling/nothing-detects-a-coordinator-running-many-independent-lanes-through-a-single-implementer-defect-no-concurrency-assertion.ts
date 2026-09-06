export const DEFECT_ID = "defect-no-concurrency-assertion";
export const ERROR_CODE =
  "NO_ASSERTION_THAT_READY_LANES_GET_DISTINCT_IMPLEMENTERS";
export const DEFECT_TITLE =
  "Defect Remediation: Nothing detects a coordinator running many independent lanes through a single implementer";

export interface LaneExecutionRecord {
  readonly laneId: string;
  readonly implementerActor: string;
  readonly dependencies?: readonly string[];
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export interface ConcurrencyAssertionContext {
  readonly waveId: string;
  readonly lanes: readonly LaneExecutionRecord[];
  readonly coordinatorActor?: string;
  readonly allowSequentialFallback?: boolean;
}

export interface ConcurrencyAssertionResult {
  readonly remediated: boolean;
  readonly defectId: string;
  readonly errorCode: string;
  readonly valid: boolean;
  readonly totalLanes: number;
  readonly distinctImplementerCount: number;
  readonly violations: readonly string[];
  readonly implementerLaneMap: Readonly<Record<string, readonly string[]>>;
}

export function assertIndependentLanesConcurrency(
  context: ConcurrencyAssertionContext,
): ConcurrencyAssertionResult {
  const { waveId, lanes, allowSequentialFallback = false } = context;
  const violations: string[] = [];
  const map: Record<string, string[]> = {};

  const independentLanes = lanes.filter(
    (l) => !l.dependencies || l.dependencies.length === 0,
  );

  for (const lane of independentLanes) {
    const actor = lane.implementerActor;
    if (!map[actor]) {
      map[actor] = [];
    }
    map[actor].push(lane.laneId);
  }

  const distinctCount = Object.keys(map).length;

  if (!allowSequentialFallback && independentLanes.length > 1) {
    for (const [actor, assignedLanes] of Object.entries(map)) {
      if (assignedLanes.length > 1) {
        violations.push(
          `Actor '${actor}' was assigned multiple independent lanes [${assignedLanes.join(
            ", ",
          )}] in wave '${waveId}' violating concurrency SLA`,
        );
      }
    }
  }

  const valid = violations.length === 0;

  return {
    remediated: true,
    defectId: DEFECT_ID,
    errorCode: ERROR_CODE,
    valid,
    totalLanes: lanes.length,
    distinctImplementerCount: distinctCount,
    violations,
    implementerLaneMap: map,
  };
}

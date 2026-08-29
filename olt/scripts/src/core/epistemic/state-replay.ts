import { calculateEpistemicGrade, clamp } from "./math.ts";
import { EpistemicIndexStore } from "./query.ts";
import type {
  BayesianBeliefState,
  EpistemicGrade,
  EpistemicRecord,
  EpistemicStateDiff,
  EpistemicStateSnapshot,
  EpistemicStreamEvent,
  ReplayedEpistemicState,
} from "./types.ts";

export type { EpistemicStateDiff, EpistemicStateSnapshot, ReplayedEpistemicState };

export class EpistemicStateReplayer {
  private readonly records = new Map<string, EpistemicRecord>();
  private readonly beliefStates = new Map<string, BayesianBeliefState>();
  private eventCount = 0;
  private lastEventId: string | undefined;
  private currentTimestamp = 0;

  public applyEvent(event: EpistemicStreamEvent): void {
    this.eventCount += 1;
    this.lastEventId = event.id;
    this.currentTimestamp = Math.max(this.currentTimestamp, event.timestamp);

    const payload = event.payload as Record<string, unknown>;
    const targetId = typeof payload.recordId === "string" ? payload.recordId : event.id;

    if (event.type === "claim:registered") {
      const score = typeof event.confidence === "number" ? clamp(event.confidence, 0, 1) : 0.5;
      const grade = event.grade ?? calculateEpistemicGrade(score);
      const record: EpistemicRecord = {
        id: targetId,
        timestamp: event.timestamp,
        score,
        grade,
        level:
          typeof payload.level === "string"
            ? (payload.level as EpistemicRecord["level"])
            : "MODERATE_CONFIDENCE",
        grounded: typeof payload.grounded === "boolean" ? payload.grounded : true,
        vector: (payload.vector as EpistemicRecord["vector"]) ?? {
          empirical: score,
          coherence: 1,
          falsifiability: 1,
          stability: 1,
          coverage: 1,
        },
        entropy: typeof payload.entropy === "number" ? payload.entropy : 0,
        contradictionCount:
          typeof payload.contradictionCount === "number" ? payload.contradictionCount : 0,
        tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
        metadata: payload.metadata as Record<string, unknown> | undefined,
      };
      this.records.set(targetId, record);
    } else if (event.type === "score:recalculated" || event.type === "grade:transition") {
      const existing = this.records.get(targetId);
      if (existing) {
        const score =
          typeof event.confidence === "number" ? clamp(event.confidence, 0, 1) : existing.score;
        const grade = event.grade ?? calculateEpistemicGrade(score);
        this.records.set(targetId, {
          ...existing,
          score,
          grade,
          timestamp: event.timestamp,
        });
      }
    } else if (event.type === "contradiction:detected") {
      const existing = this.records.get(targetId);
      if (existing) {
        const addCount =
          typeof payload.contradictionCount === "number" ? payload.contradictionCount : 1;
        this.records.set(targetId, {
          ...existing,
          contradictionCount: existing.contradictionCount + addCount,
          timestamp: event.timestamp,
        });
      }
    } else if (event.type === "entropy:shifted") {
      const existing = this.records.get(targetId);
      if (existing && typeof payload.entropy === "number") {
        this.records.set(targetId, {
          ...existing,
          entropy: payload.entropy,
          timestamp: event.timestamp,
        });
      }
    }

    if (payload.beliefState && typeof payload.beliefState === "object") {
      const bs = payload.beliefState as BayesianBeliefState;
      if (typeof bs.hypothesisId === "string") {
        this.beliefStates.set(bs.hypothesisId, bs);
      }
    }
  }

  public applyBatch(events: readonly EpistemicStreamEvent[]): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  public replayToTimestamp(
    events: readonly EpistemicStreamEvent[],
    targetTimestamp: number,
  ): ReplayedEpistemicState {
    this.reset();
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of sorted) {
      if (event.timestamp > targetTimestamp) break;
      this.applyEvent(event);
    }
    return this.getState();
  }

  public createSnapshot(): EpistemicStateSnapshot {
    return {
      timestamp: this.currentTimestamp,
      records: Array.from(this.records.values()),
      beliefStates: Array.from(this.beliefStates.values()),
      eventCount: this.eventCount,
      lastEventId: this.lastEventId,
    };
  }

  public restoreFromSnapshot(snapshot: EpistemicStateSnapshot): void {
    this.reset();
    this.currentTimestamp = snapshot.timestamp;
    this.eventCount = snapshot.eventCount;
    this.lastEventId = snapshot.lastEventId;

    for (const record of snapshot.records) {
      this.records.set(record.id, record);
    }
    for (const bs of snapshot.beliefStates) {
      this.beliefStates.set(bs.hypothesisId, bs);
    }
  }

  public getState(): ReplayedEpistemicState {
    return {
      timestamp: this.currentTimestamp,
      records: new Map(this.records),
      beliefStates: new Map(this.beliefStates),
      eventCount: this.eventCount,
      lastEventId: this.lastEventId,
    };
  }

  public reset(): void {
    this.records.clear();
    this.beliefStates.clear();
    this.eventCount = 0;
    this.lastEventId = undefined;
    this.currentTimestamp = 0;
  }
}

export function diffEpistemicStates(
  stateA: ReplayedEpistemicState,
  stateB: ReplayedEpistemicState,
): EpistemicStateDiff {
  const addedRecordIds: string[] = [];
  const removedRecordIds: string[] = [];
  const modifiedRecordIds: string[] = [];
  const scoreDeltas: Record<string, number> = {};
  const gradeTransitions: Record<string, { from: EpistemicGrade; to: EpistemicGrade }> = {};

  for (const [id, recB] of stateB.records.entries()) {
    const recA = stateA.records.get(id);
    if (!recA) {
      addedRecordIds.push(id);
    } else {
      if (
        recA.score !== recB.score ||
        recA.grade !== recB.grade ||
        recA.contradictionCount !== recB.contradictionCount
      ) {
        modifiedRecordIds.push(id);
        scoreDeltas[id] = Number((recB.score - recA.score).toFixed(6));
        if (recA.grade !== recB.grade) {
          gradeTransitions[id] = { from: recA.grade, to: recB.grade };
        }
      }
    }
  }

  for (const id of stateA.records.keys()) {
    if (!stateB.records.has(id)) {
      removedRecordIds.push(id);
    }
  }

  return {
    addedRecordIds,
    removedRecordIds,
    modifiedRecordIds,
    scoreDeltas,
    gradeTransitions,
  };
}

export function reconstructEpistemicState(
  events: readonly EpistemicStreamEvent[],
  snapshot?: EpistemicStateSnapshot,
): ReplayedEpistemicState {
  const replayer = new EpistemicStateReplayer();
  if (snapshot) {
    replayer.restoreFromSnapshot(snapshot);
  }
  replayer.applyBatch(events);
  return replayer.getState();
}

export function buildSparseIndexFromState(state: ReplayedEpistemicState): EpistemicIndexStore {
  const store = new EpistemicIndexStore();
  store.addMany(Array.from(state.records.values()));
  return store;
}

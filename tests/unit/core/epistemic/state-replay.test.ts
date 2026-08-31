import { describe, expect, test } from "bun:test";
import {
  buildSparseIndexFromState,
  diffEpistemicStates,
  EpistemicStateReplayer,
  reconstructEpistemicState,
  type EpistemicStateSnapshot,
  type EpistemicStreamEvent,
} from "../../../../olt/scripts/src/core/epistemic/index.ts";

function createMockStreamEvent(partial: Partial<EpistemicStreamEvent> = {}): EpistemicStreamEvent {
  return {
    id: partial.id ?? `evt-${Date.now()}`,
    type: partial.type ?? "claim:registered",
    timestamp: partial.timestamp ?? 1000,
    payload: partial.payload ?? { recordId: "claim-1", tags: ["core", "eval"] },
    confidence: "confidence" in partial ? partial.confidence : 0.8,
    grade: "grade" in partial ? partial.grade : "HIGH",
    source: partial.source ?? "test",
  };
}

describe("Epistemic State Replayer", () => {
  test("replays event sequences to build up epistemic record states", () => {
    const replayer = new EpistemicStateReplayer();
    const e1 = createMockStreamEvent({
      id: "e1",
      type: "claim:registered",
      timestamp: 1000,
      confidence: 0.6,
      grade: "MEDIUM",
      payload: { recordId: "c1", tags: ["alpha"] },
    });
    const e2 = createMockStreamEvent({
      id: "e2",
      type: "score:recalculated",
      timestamp: 2000,
      confidence: 0.95,
      grade: "VERY_HIGH",
      payload: { recordId: "c1" },
    });
    const e3 = createMockStreamEvent({
      id: "e3",
      type: "contradiction:detected",
      timestamp: 3000,
      payload: { recordId: "c1", contradictionCount: 2 },
    });

    replayer.applyBatch([e1, e2, e3]);
    const state = replayer.getState();

    expect(state.eventCount).toBe(3);
    expect(state.lastEventId).toBe("e3");
    expect(state.timestamp).toBe(3000);

    const record = state.records.get("c1");
    expect(record).toBeDefined();
    expect(record?.score).toBe(0.95);
    expect(record?.grade).toBe("VERY_HIGH");
    expect(record?.contradictionCount).toBe(2);
    expect(record?.tags).toEqual(["alpha"]);

    replayer.reset();
    const resetState = replayer.getState();
    expect(resetState.eventCount).toBe(0);
    expect(resetState.records.size).toBe(0);
    expect(resetState.lastEventId).toBeUndefined();
  });

  test("applies claim:registered with default attributes when properties are omitted", () => {
    const replayer = new EpistemicStateReplayer();
    const eDefault = createMockStreamEvent({
      id: "evt-default",
      type: "claim:registered",
      confidence: undefined,
      grade: undefined,
      payload: {},
    });

    replayer.applyEvent(eDefault);
    const state = replayer.getState();
    const rec = state.records.get("evt-default");
    expect(rec).toBeDefined();
    expect(rec?.score).toBe(0.5);
    expect(rec?.level).toBe("MODERATE_CONFIDENCE");
    expect(rec?.grounded).toBe(true);
    expect(rec?.entropy).toBe(0);
    expect(rec?.contradictionCount).toBe(0);
    expect(rec?.tags).toEqual([]);
  });

  test("handles grade:transition, entropy:shifted, default contradiction increment, and ignores unknown target ids", () => {
    const replayer = new EpistemicStateReplayer();
    replayer.applyEvent(createMockStreamEvent({
      id: "e1",
      type: "claim:registered",
      confidence: 0.5,
      payload: { recordId: "c1" },
    }));

    // grade:transition
    replayer.applyEvent(createMockStreamEvent({
      id: "e2",
      type: "grade:transition",
      confidence: 0.9,
      grade: "VERY_HIGH",
      payload: { recordId: "c1" },
    }));
    expect(replayer.getState().records.get("c1")?.grade).toBe("VERY_HIGH");

    // contradiction:detected with default count
    replayer.applyEvent(createMockStreamEvent({
      id: "e3",
      type: "contradiction:detected",
      payload: { recordId: "c1" },
    }));
    expect(replayer.getState().records.get("c1")?.contradictionCount).toBe(1);

    // entropy:shifted
    replayer.applyEvent(createMockStreamEvent({
      id: "e4",
      type: "entropy:shifted",
      payload: { recordId: "c1", entropy: 0.45 },
    }));
    expect(replayer.getState().records.get("c1")?.entropy).toBe(0.45);

    // events on non-existent record (should not crash)
    replayer.applyEvent(createMockStreamEvent({
      id: "e-unknown",
      type: "score:recalculated",
      payload: { recordId: "c-unknown" },
    }));
    replayer.applyEvent(createMockStreamEvent({
      id: "e-unknown-contra",
      type: "contradiction:detected",
      payload: { recordId: "c-unknown" },
    }));
    replayer.applyEvent(createMockStreamEvent({
      id: "e-unknown-entropy",
      type: "entropy:shifted",
      payload: { recordId: "c-unknown", entropy: 0.1 },
    }));
  });

  test("performs point-in-time state reconstruction (time-travel replay)", () => {
    const replayer = new EpistemicStateReplayer();
    const events: EpistemicStreamEvent[] = [
      createMockStreamEvent({
        id: "e1",
        type: "claim:registered",
        timestamp: 1000,
        confidence: 0.4,
        grade: "LOW",
        payload: { recordId: "c1" },
      }),
      createMockStreamEvent({
        id: "e2",
        type: "score:recalculated",
        timestamp: 2000,
        confidence: 0.8,
        grade: "HIGH",
        payload: { recordId: "c1" },
      }),
      createMockStreamEvent({
        id: "e3",
        type: "score:recalculated",
        timestamp: 3000,
        confidence: 0.95,
        grade: "VERY_HIGH",
        payload: { recordId: "c1" },
      }),
    ];

    const pastState = replayer.replayToTimestamp(events, 2000);
    expect(pastState.records.get("c1")?.score).toBe(0.8);
    expect(pastState.records.get("c1")?.grade).toBe("HIGH");
    expect(pastState.eventCount).toBe(2);

    const fullState = replayer.replayToTimestamp(events, 5000);
    expect(fullState.records.get("c1")?.score).toBe(0.95);
    expect(fullState.records.get("c1")?.grade).toBe("VERY_HIGH");
    expect(fullState.eventCount).toBe(3);
  });

  test("creates snapshots and restores state accurately", () => {
    const replayer = new EpistemicStateReplayer();
    replayer.applyEvent(
      createMockStreamEvent({
        id: "e1",
        type: "claim:registered",
        timestamp: 1500,
        confidence: 0.85,
        payload: {
          recordId: "c1",
          beliefState: {
            hypothesisId: "h1",
            priorProbability: 0.5,
            posteriorProbability: 0.88,
            logOdds: 1.99,
            evidenceCount: 4,
            grade: "HIGH",
            confidenceLevel: "HIGH_CONFIDENCE",
            updatedAt: 1500,
          },
        },
      }),
    );

    const snapshot = replayer.createSnapshot();
    expect(snapshot.records.length).toBe(1);
    expect(snapshot.beliefStates.length).toBe(1);

    const restoredReplayer = new EpistemicStateReplayer();
    restoredReplayer.restoreFromSnapshot(snapshot);
    const restoredState = restoredReplayer.getState();

    expect(restoredState.records.get("c1")?.score).toBe(0.85);
    expect(restoredState.beliefStates.get("h1")?.posteriorProbability).toBe(0.88);
  });
});

describe("Epistemic State Diffing & Reconstruct Helper", () => {
  test("detects added, removed, modified records and grade transitions", () => {
    const replayerA = new EpistemicStateReplayer();
    replayerA.applyBatch([
      createMockStreamEvent({
        id: "e1",
        type: "claim:registered",
        confidence: 0.5,
        grade: "MEDIUM",
        payload: { recordId: "c1" },
      }),
      createMockStreamEvent({
        id: "e2",
        type: "claim:registered",
        confidence: 0.7,
        grade: "MEDIUM",
        payload: { recordId: "c2" },
      }),
      createMockStreamEvent({
        id: "e4",
        type: "claim:registered",
        confidence: 0.8,
        grade: "HIGH",
        payload: { recordId: "c4" },
      }),
    ]);

    const replayerB = new EpistemicStateReplayer();
    replayerB.applyBatch([
      createMockStreamEvent({
        id: "e1",
        type: "claim:registered",
        confidence: 0.9,
        grade: "VERY_HIGH",
        payload: { recordId: "c1" },
      }),
      createMockStreamEvent({
        id: "e3",
        type: "claim:registered",
        confidence: 0.6,
        grade: "MEDIUM",
        payload: { recordId: "c3" },
      }),
      createMockStreamEvent({
        id: "e4",
        type: "claim:registered",
        confidence: 0.8,
        grade: "HIGH",
        payload: { recordId: "c4" },
      }),
    ]);

    const diff = diffEpistemicStates(replayerA.getState(), replayerB.getState());
    expect(diff.addedRecordIds).toEqual(["c3"]);
    expect(diff.removedRecordIds).toEqual(["c2"]);
    expect(diff.modifiedRecordIds).toEqual(["c1"]);
    expect(diff.scoreDeltas["c1"]).toBeCloseTo(0.4, 4);
    expect(diff.gradeTransitions["c1"]).toEqual({ from: "MEDIUM", to: "VERY_HIGH" });
  });

  test("reconstructEpistemicState applies snapshot + delta events and handles empty snapshot", () => {
    const snapshot: EpistemicStateSnapshot = {
      timestamp: 1000,
      eventCount: 1,
      lastEventId: "snap-e1",
      records: [
        {
          id: "c1",
          timestamp: 1000,
          score: 0.6,
          grade: "MEDIUM",
          level: "MODERATE_CONFIDENCE",
          grounded: true,
          vector: { empirical: 0.6, coherence: 1, falsifiability: 1, stability: 1, coverage: 1 },
          entropy: 0.2,
          contradictionCount: 0,
          tags: ["snapshot"],
        },
      ],
      beliefStates: [],
    };

    const deltaEvents: EpistemicStreamEvent[] = [
      createMockStreamEvent({
        id: "delta-1",
        type: "score:recalculated",
        timestamp: 2000,
        confidence: 0.92,
        grade: "VERY_HIGH",
        payload: { recordId: "c1" },
      }),
    ];

    const state = reconstructEpistemicState(deltaEvents, snapshot);
    expect(state.records.get("c1")?.score).toBe(0.92);
    expect(state.records.get("c1")?.grade).toBe("VERY_HIGH");
    expect(state.eventCount).toBe(2);

    // Reconstruct without snapshot
    const stateNoSnap = reconstructEpistemicState(deltaEvents);
    expect(stateNoSnap.eventCount).toBe(1);
  });

  test("buildSparseIndexFromState produces a queryable index store", () => {
    const replayer = new EpistemicStateReplayer();
    replayer.applyBatch([
      createMockStreamEvent({
        id: "e1",
        type: "claim:registered",
        confidence: 0.9,
        grade: "VERY_HIGH",
        payload: { recordId: "c1", tags: ["t1"] },
      }),
      createMockStreamEvent({
        id: "e2",
        type: "claim:registered",
        confidence: 0.3,
        grade: "VERY_LOW",
        payload: { recordId: "c2", tags: ["t2"] },
      }),
    ]);

    const state = replayer.getState();
    const indexStore = buildSparseIndexFromState(state);

    expect(indexStore.size()).toBe(2);
    const query = indexStore.queryCandidates({ grades: ["VERY_HIGH"] });
    expect(query.candidateIds?.has("c1")).toBe(true);
    expect(query.candidateIds?.has("c2")).toBe(false);
  });
});
